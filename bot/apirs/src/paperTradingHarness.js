'use strict';

const { INITIAL_BALANCE } = require('./constants');
const {
  computeDrawdownPenalty,
  computeVolatilityPenalty,
  computeLossPenalty,
  computeFinalAppliedRisk,
} = require('./positionSizing');
const { evaluateProfitLock } = require('./profitLock');
const {
  STRATEGY_A,
  HALTED,
  evaluateMacroCircuitBreaker,
  isTradeAllowedUnderStrategyB,
  getStrategyBRisk,
  isTierProgressionFrozen,
} = require('./macroCircuitBreaker');
const {
  evaluateMicroCircuitBreaker,
  resolveStrategyModeWithBootstrapOverride,
} = require('./microCircuitBreaker');
const {
  recordTradeOutcome,
  computeLiveWinProbability,
  computeConsecutiveLosses,
} = require('./learningEngine');

/**
 * 12_Roadmap.md Phase 3's own exit criteria: "APIRS correctly computes
 * tier, risk score, position size, profit-lock, and both circuit breakers
 * against simulated trade sequences — verified in paper mode, zero API
 * spend." This module is that harness: it composes every Section 3-8
 * module built so far into a single per-trade simulation loop, entirely
 * in-memory, with no broker/AI calls.
 *
 * This is deliberately separate from — and does not reintroduce —
 * 08_Bot_Architecture.md's former Section 11 (removed, this revision).
 * Section 11 was a *policy*: a minimum-trade-count gate before real
 * money could be used. This harness is *test infrastructure*: a way to
 * run and assert against simulated trade sequences. It has no concept of
 * "graduating" a strategy or blocking live trading — it is only ever
 * invoked explicitly, by tests, and produces no side effects of its own.
 *
 * Per Roadmap Phase 3's own scoping ("Strategy A's trade signals are
 * stubbed/manual for this phase — no Market Intelligence, News AI, or
 * Strategy Engine yet"), every simulated trade's environment inputs
 * (strategyConfidence, marketQuality, trendQuality, marketVolatility,
 * ATR values, dailyDrawdownPct) are supplied directly by the caller
 * rather than computed by Modules 2-4, which don't exist yet.
 *
 * Trade payoff modeling note (not spec-derived — flagged as a testing
 * convention): each simulated trade supplies an `outcomeRMultiple`
 * (e.g. -1.0 = a full stop-loss hit, +2.0 = a 2R win). Realized P&L is
 * `appliedRisk * balanceBeforeTrade * outcomeRMultiple`. Real fill/stop
 * behavior is Module 7 (Execution Engine)'s concern (Phase 4+); this
 * harness only needs *a* deterministic, risk-proportional way to move
 * the simulated balance so the sequence-level math (tiers, profit-lock,
 * breakers) can be exercised.
 */

/**
 * Fresh account state, mirroring 08_Bot_Architecture.md Section 2's
 * initial parameters. `initialBalance` is kept on state (rather than
 * assumed to always equal the INITIAL_BALANCE constant) because Section
 * 5's profit-lock needs the account's own fixed starting balance for its
 * net_profit calculation, and tests may want to start a sequence at a
 * different point (e.g. already in the standard regime).
 */
function createInitialState({ initialBalance = INITIAL_BALANCE } = {}) {
  return {
    balance: initialBalance,
    peakEquity: initialBalance,
    activeStrategyMode: STRATEGY_A,
    currentTier: 0,
    initialBalance,
    tradeHistory: [],
  };
}

function determineTradeApproval({ activeStrategyMode }, tradeInput) {
  if (activeStrategyMode === HALTED) {
    return { tradeApproved: false, reason: 'HALTED' };
  }
  if (activeStrategyMode !== STRATEGY_A && !isTradeAllowedUnderStrategyB(tradeInput.strategyConfidence)) {
    return { tradeApproved: false, reason: 'BELOW_STRATEGY_B_CONFIDENCE_BAR' };
  }
  return { tradeApproved: true, reason: null };
}

/**
 * Section 4 (base sizing) composed with Section 6.1 (Strategy B's flat
 * override) and Section 7 (the micro breaker's forced floor, including
 * the Section 3a single-loss override's sibling rule — the *standard*
 * two-strike leg, evaluated here same as any other balance).
 *
 * `completedBlocks: state.currentTier` relies on a deliberate equivalence
 * rather than a coincidence: Section 3's tier row is selected by an
 * integer "Completed Blocks" count, saturating at 7 ("7+"). state.currentTier
 * is already that same saturating 0-7 index, maintained incrementally by
 * Section 5 (profitLock.js). Feeding it back in as "completedBlocks"
 * round-trips to the identical tier row — getStandardTier(n) resolves to
 * tier n for any n in [0,7] and to tier 7 for n >= 7, which is exactly
 * what currentTier already represents. Below $50 this parameter is
 * unused entirely (bootstrap regime keys off balance only), so the
 * equivalence is moot there.
 */
function computeAppliedRisk(state, tradeInput, learningInputs) {
  const drawdownPenalty = computeDrawdownPenalty({
    peakEquity: state.peakEquity,
    activeTradingBalance: state.balance,
  });
  const volatilityPenalty = computeVolatilityPenalty({
    currentATR: tradeInput.currentATR,
    rollingAvgATR: tradeInput.rollingAvgATR,
  });
  const lossPenalty = computeLossPenalty({ consecutiveLosses: learningInputs.consecutiveLosses });

  const sizing = computeFinalAppliedRisk({
    balance: state.balance,
    completedBlocks: state.currentTier,
    strategyConfidence: tradeInput.strategyConfidence,
    liveWinProbability: learningInputs.liveWinProbability,
    marketQuality: tradeInput.marketQuality,
    trendQuality: tradeInput.trendQuality,
    drawdownPenalty,
    volatilityPenalty,
    lossPenalty,
  });

  let appliedRisk = sizing.finalRisk;
  let riskSource = 'section4_tier_based';

  if (state.activeStrategyMode !== STRATEGY_A) {
    appliedRisk = getStrategyBRisk();
    riskSource = 'section6_1_strategy_b_flat';
  }

  const microResult = evaluateMicroCircuitBreaker({
    marketVolatility: tradeInput.marketVolatility,
    consecutiveLosses: learningInputs.consecutiveLosses,
    dailyDrawdownPct: tradeInput.dailyDrawdownPct,
    strategyConfidence: tradeInput.strategyConfidence,
  });

  if (microResult.forcedToEmergencyFloor) {
    appliedRisk = microResult.forcedRisk;
    riskSource = 'section7_forced_floor';
  }

  return {
    appliedRisk,
    riskSource,
    drawdownPenalty,
    volatilityPenalty,
    lossPenalty,
    sizing,
    microResult,
  };
}

/**
 * Runs one simulated trade against the full APIRS pipeline. Pure
 * function: returns the resulting state and a full trace of every
 * intermediate decision, without mutating the input state.
 *
 * tradeInput shape:
 *   { strategyConfidence, marketQuality, trendQuality, marketVolatility,
 *     currentATR, rollingAvgATR, dailyDrawdownPct, outcomeRMultiple }
 */
function runTradeCycle(state, tradeInput) {
  const learningInputs = {
    liveWinProbability: computeLiveWinProbability(state.tradeHistory),
    consecutiveLosses: computeConsecutiveLosses(state.tradeHistory),
  };

  const approval = determineTradeApproval(state, tradeInput);
  if (!approval.tradeApproved) {
    return {
      state,
      trace: { tradeApproved: false, reason: approval.reason, learningInputs },
    };
  }

  const riskResult = computeAppliedRisk(state, tradeInput, learningInputs);

  const balanceBeforeTrade = state.balance;
  const riskedAmount = riskResult.appliedRisk * balanceBeforeTrade;
  const pnlAmount = riskedAmount * tradeInput.outcomeRMultiple;
  const balanceAfterTrade = balanceBeforeTrade + pnlAmount;
  const wasWin = pnlAmount > 0;

  const newTradeHistory = recordTradeOutcome(state.tradeHistory, {
    wasWin,
    pnlAmount,
    conditions: tradeInput,
  });

  const macroResult = evaluateMacroCircuitBreaker({
    activeTradingBalance: balanceAfterTrade,
    peakEquity: state.peakEquity,
    activeStrategyMode: state.activeStrategyMode,
  });

  const modeResult = resolveStrategyModeWithBootstrapOverride({
    macroResult,
    balanceBeforeTrade,
    tradeWasLoss: !wasWin,
  });

  let finalBalance = balanceAfterTrade;
  let finalPeakEquity = modeResult.peakEquity;
  let finalTier = state.currentTier;
  let profitLockResult = null;

  if (!isTierProgressionFrozen(modeResult.activeStrategyMode)) {
    profitLockResult = evaluateProfitLock({
      activeTradingBalance: balanceAfterTrade,
      peakEquity: modeResult.peakEquity,
      initialBalance: state.initialBalance,
      currentTier: state.currentTier,
    });
    finalBalance = profitLockResult.activeTradingBalance;
    finalPeakEquity = profitLockResult.peakEquity;
    finalTier = profitLockResult.currentTier;
  }

  const newState = {
    balance: finalBalance,
    peakEquity: finalPeakEquity,
    activeStrategyMode: modeResult.activeStrategyMode,
    currentTier: finalTier,
    initialBalance: state.initialBalance,
    tradeHistory: newTradeHistory,
  };

  return {
    state: newState,
    trace: {
      tradeApproved: true,
      learningInputs,
      riskResult,
      balanceBeforeTrade,
      pnlAmount,
      balanceAfterTrade,
      wasWin,
      macroResult,
      modeResult,
      profitLockResult,
    },
  };
}

/**
 * Runs a full sequence of simulated trades, folding runTradeCycle over
 * the list. Returns the final state plus the per-trade trace array, so
 * tests can assert against both the end state and any intermediate step.
 */
function runSequence(initialState, tradeInputs) {
  const traces = [];
  let state = initialState;
  for (const tradeInput of tradeInputs) {
    const result = runTradeCycle(state, tradeInput);
    state = result.state;
    traces.push(result.trace);
  }
  return { finalState: state, traces };
}

module.exports = {
  createInitialState,
  runTradeCycle,
  runSequence,
};
