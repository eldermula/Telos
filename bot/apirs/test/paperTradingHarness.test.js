'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createInitialState,
  runTradeCycle,
  runSequence,
  evaluateEntry,
} = require('../src/paperTradingHarness');
const { STRATEGY_A, STRATEGY_B, HALTED } = require('../src/macroCircuitBreaker');
const { TIER_MATRIX } = require('../src/tierMatrix');

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be close to ${expected}`
  );
}

const neutralBootstrapTrade = {
  strategyConfidence: 1,
  marketQuality: 1,
  trendQuality: 1,
  marketVolatility: 'NORMAL',
  currentATR: 1,
  rollingAvgATR: 1,
  dailyDrawdownPct: 0,
};

// --- Phase 3 exit criteria: position sizing, bootstrap regime ------------

test('bootstrap regime: first trade sizes at the 70% flat-cap ceiling and a win compounds correctly', () => {
  const state = createInitialState(); // $10, per Section 2
  const { state: newState, trace } = runTradeCycle(state, { ...neutralBootstrapTrade, outcomeRMultiple: 1 });

  assert.equal(trace.tradeApproved, true);
  assertClose(trace.riskResult.appliedRisk, 0.70); // clamped to bootstrap ceiling
  assert.equal(trace.riskResult.riskSource, 'section4_tier_based');
  assertClose(trace.balanceAfterTrade, 17); // $10 + (0.70 * $10 * 1R)
  assert.equal(newState.activeStrategyMode, STRATEGY_A);
  assert.equal(newState.currentTier, 0); // still below $50, profit-lock doesn't apply
});

// --- Both circuit breakers, exercised through the full pipeline ----------

test('macro breaker alone escalates A -> B on a single large bootstrap-ceiling loss', () => {
  const state = createInitialState();
  const { state: newState, trace } = runTradeCycle(state, { ...neutralBootstrapTrade, outcomeRMultiple: -1 });

  assertClose(trace.riskResult.appliedRisk, 0.70);
  assertClose(trace.balanceAfterTrade, 3); // $10 - 70% of $10
  assert.equal(trace.macroResult.macroBreachTriggered, true);
  // Drawdown (70%) alone already clears the 45% macro threshold, so the
  // Section 3a addendum isn't even needed to explain this transition.
  assert.equal(trace.modeResult.bootstrapSingleLossOverrideTriggered, false);
  assert.equal(newState.activeStrategyMode, STRATEGY_B);
});

test('bootstrap single-loss override fires when the macro drawdown check alone would not have', () => {
  const state = createInitialState();
  // Deliberately low market quality/trend + a volatility penalty keeps
  // risk_score low enough that even a full -1R loss stays under the 45%
  // macro threshold, isolating the addendum's own contribution.
  const tradeInput = {
    strategyConfidence: 0.85, // above both Section 7's 80% floor and NOT the 90% Strategy B bar (irrelevant here, still in A)
    marketQuality: 0,
    trendQuality: 0,
    marketVolatility: 'NORMAL',
    currentATR: 3,
    rollingAvgATR: 1, // volatility_penalty = 1.0
    dailyDrawdownPct: 0,
    outcomeRMultiple: -1,
  };

  const { state: newState, trace } = runTradeCycle(state, tradeInput);

  assertClose(trace.riskResult.appliedRisk, 0.245); // 0.70 * (0.85+0.5+0+0-0-1-0)
  assertClose(trace.balanceAfterTrade, 7.55);
  assertClose(trace.macroResult.drawdownFromPeak, 0.245);
  assert.equal(trace.macroResult.macroBreachTriggered, false); // macro alone: no breach
  assert.equal(trace.modeResult.bootstrapSingleLossOverrideTriggered, true); // addendum: fires anyway
  assert.equal(newState.activeStrategyMode, STRATEGY_B);
});

test('Two-Strike Rule: the third trade is forced to the emergency floor after two prior losses', () => {
  const state = createInitialState({ initialBalance: 200 }); // standard regime from the start
  const lossTrade = {
    strategyConfidence: 0.9,
    marketQuality: 0.9,
    trendQuality: 0.9,
    marketVolatility: 'NORMAL',
    currentATR: 1,
    rollingAvgATR: 1,
    dailyDrawdownPct: 0,
    outcomeRMultiple: -1,
  };

  const { finalState, traces } = runSequence(state, [lossTrade, lossTrade]);
  assert.equal(traces[0].riskResult.microResult.forcedToEmergencyFloor, false); // consecutiveLosses=0 entering trade 1
  assert.equal(traces[1].riskResult.microResult.forcedToEmergencyFloor, false); // consecutiveLosses=1 entering trade 2

  const thirdTrade = { ...lossTrade, strategyConfidence: 0.95, outcomeRMultiple: 1 }; // would otherwise size normally
  const { trace: thirdTrace } = runTradeCycle(finalState, thirdTrade);

  assert.equal(thirdTrace.riskResult.microResult.triggeredConditions.twoStrike, true);
  assert.equal(thirdTrace.riskResult.microResult.forcedToEmergencyFloor, true);
  assertClose(thirdTrace.riskResult.appliedRisk, 0.01);
  assert.equal(thirdTrace.riskResult.riskSource, 'section7_forced_floor');
});

test('daily drawdown >= 15% forces the emergency floor even with a high-confidence, high-quality setup', () => {
  const state = createInitialState({ initialBalance: 200 });
  const tradeInput = {
    strategyConfidence: 0.99,
    marketQuality: 1,
    trendQuality: 1,
    marketVolatility: 'NORMAL',
    currentATR: 1,
    rollingAvgATR: 1,
    dailyDrawdownPct: 0.15,
    outcomeRMultiple: 1,
  };

  const { trace } = runTradeCycle(state, tradeInput);
  assert.equal(trace.riskResult.microResult.triggeredConditions.dailyDrawdown, true);
  assertClose(trace.riskResult.appliedRisk, 0.01);
});

// --- Profit-lock + tier advancement, exercised through the full pipeline -

test('profit-lock triggers and advances the tier once net profit crosses one full step', () => {
  const state = createInitialState({ initialBalance: 200 }); // standard regime, Tier 0, $150 step size
  const tradeInput = { ...neutralBootstrapTrade, outcomeRMultiple: 15 }; // deliberately large R to cross the $150 step in one trade

  const { state: newState, trace } = runTradeCycle(state, tradeInput);

  assertClose(trace.riskResult.appliedRisk, 0.05); // Tier 0 ceiling
  assertClose(trace.balanceAfterTrade, 350); // $200 + (0.05*200*15)
  assert.equal(trace.profitLockResult.profitLockTriggered, true);
  assertClose(trace.profitLockResult.lockedProfitAmount, 105); // 150 * 0.70
  assertClose(newState.balance, 245); // 350 - 105
  assertClose(newState.peakEquity, 245); // Peak Reset Vector: reduced by the same amount
  assert.equal(newState.currentTier, 1);
});

// --- Tier-progression freeze while in Strategy B --------------------------

test('profit-lock is skipped entirely while in STRATEGY_B, even with a profitable win', () => {
  const state = {
    balance: 77,
    peakEquity: 100,
    activeStrategyMode: STRATEGY_B,
    currentTier: 2,
    initialBalance: 10,
    tradeHistory: [],
  };
  const tradeInput = {
    strategyConfidence: 0.95, // clears the Strategy B 90% confidence bar
    marketQuality: 1,
    trendQuality: 1,
    marketVolatility: 'NORMAL',
    currentATR: 1,
    rollingAvgATR: 1,
    dailyDrawdownPct: 0,
    outcomeRMultiple: 0.1, // small win, stays well inside the recovery band (drawdown stays >= 22.5%)
  };

  const { state: newState, trace } = runTradeCycle(state, tradeInput);
  assert.equal(trace.riskResult.riskSource, 'section6_1_strategy_b_flat');
  assertClose(trace.riskResult.appliedRisk, 0.01);
  assert.equal(newState.activeStrategyMode, STRATEGY_B); // not yet recovered
  assert.equal(trace.profitLockResult, null); // frozen — never evaluated
  assert.equal(newState.currentTier, 2); // unchanged
});

test('recovery hysteresis: a win that drops drawdown under 22.5% returns to STRATEGY_A and un-freezes profit-lock', () => {
  const state = {
    balance: 77, // 23% down from peak 100 — inside STRATEGY_B, not yet recovered
    peakEquity: 100,
    activeStrategyMode: STRATEGY_B,
    currentTier: 2,
    initialBalance: 10,
    tradeHistory: [],
  };
  const tradeInput = {
    strategyConfidence: 0.95,
    marketQuality: 1,
    trendQuality: 1,
    marketVolatility: 'NORMAL',
    currentATR: 1,
    rollingAvgATR: 1,
    dailyDrawdownPct: 0,
    outcomeRMultiple: 1, // 1R win at the flat 1% Strategy B risk: balance -> 77.77, drawdown -> 22.23%
  };

  const { state: newState, trace } = runTradeCycle(state, tradeInput);

  assert.equal(trace.macroResult.recoveredToStrategyA, true);
  assert.equal(newState.activeStrategyMode, STRATEGY_A);
  // Tier progression is unfrozen again this same cycle, so profit-lock
  // was actually evaluated (it happened to be a no-op — no new block
  // completed — but the freeze/unfreeze composition itself is what's
  // under test here).
  assert.notEqual(trace.profitLockResult, null);
  assert.equal(trace.profitLockResult.profitLockTriggered, false);
});

// --- Trade-approval gating -------------------------------------------------

test('HALTED is terminal: no trade is taken and state is left untouched', () => {
  const state = {
    balance: 40,
    peakEquity: 100,
    activeStrategyMode: HALTED,
    currentTier: 1,
    initialBalance: 10,
    tradeHistory: [],
  };
  const tradeInput = { ...neutralBootstrapTrade, outcomeRMultiple: 5 };

  const { state: newState, trace } = runTradeCycle(state, tradeInput);
  assert.equal(trace.tradeApproved, false);
  assert.equal(trace.reason, 'HALTED');
  assert.equal(newState, state); // same reference — nothing recomputed
});

test('STRATEGY_B rejects trades below its 90% confidence bar, leaving state untouched', () => {
  const state = {
    balance: 77,
    peakEquity: 100,
    activeStrategyMode: STRATEGY_B,
    currentTier: 2,
    initialBalance: 10,
    tradeHistory: [],
  };
  const tradeInput = { ...neutralBootstrapTrade, strategyConfidence: 0.5, outcomeRMultiple: 5 };

  const { state: newState, trace } = runTradeCycle(state, tradeInput);
  assert.equal(trace.tradeApproved, false);
  assert.equal(trace.reason, 'BELOW_STRATEGY_B_CONFIDENCE_BAR');
  assert.equal(newState, state);
});

// --- Purity ----------------------------------------------------------------

test('runTradeCycle does not mutate the input state', () => {
  const state = createInitialState();
  const snapshot = JSON.parse(JSON.stringify(state));
  runTradeCycle(state, { ...neutralBootstrapTrade, outcomeRMultiple: 1 });
  assert.deepEqual(state, snapshot);
});

// --- Phase 7.8 — evaluateEntry's tierRows injection point -----------------

test('evaluateEntry — third-arg tierRows reaches the standard-regime sizing', () => {
  // Tier 0 (baseRisk 0.02, ceiling 0.05): a best-case score (riskScore=4)
  // calculates to 0.08, which the default ceiling clamps down to 0.05 —
  // same setup as positionSizing.test.js's "clamped at tier ceiling" case,
  // chosen deliberately so raising the ceiling is observable in appliedRisk.
  const state = {
    balance: 60,
    peakEquity: 60,
    activeStrategyMode: STRATEGY_A,
    currentTier: 0,
    initialBalance: 10,
    tradeHistory: [],
  };
  const tradeInput = { ...neutralBootstrapTrade, marketVolatility: 'NORMAL' };

  const withoutOverride = evaluateEntry(state, tradeInput);
  assertClose(withoutOverride.riskResult.sizing.tierParams.maxRiskCeiling, 0.05); // Tier 0 default
  assertClose(withoutOverride.riskResult.appliedRisk, 0.05); // clamped

  const overrideRows = TIER_MATRIX.map((row) =>
    row.tier === 0 ? { ...row, maxRiskCeiling: 0.99 } : row
  );
  const withOverride = evaluateEntry(state, tradeInput, { tierRows: overrideRows });
  assertClose(withOverride.riskResult.sizing.tierParams.maxRiskCeiling, 0.99);
  // No longer clamped by the (now much higher) ceiling — appliedRisk should
  // equal the raw calculatedRisk rather than the old 0.05 ceiling.
  assertClose(withOverride.riskResult.appliedRisk, withOverride.riskResult.sizing.calculatedRisk);
  assert.notEqual(withOverride.riskResult.appliedRisk, withoutOverride.riskResult.appliedRisk);
});

test('evaluateEntry — omitting the third arg behaves exactly as before (hardcoded matrix)', () => {
  const state = {
    balance: 1200,
    peakEquity: 1200,
    activeStrategyMode: STRATEGY_A,
    currentTier: 3,
    initialBalance: 10,
    tradeHistory: [],
  };
  const tradeInput = { ...neutralBootstrapTrade, marketVolatility: 'NORMAL' };

  const noThirdArg = evaluateEntry(state, tradeInput);
  const explicitEmpty = evaluateEntry(state, tradeInput, {});
  assert.deepEqual(noThirdArg, explicitEmpty);
});
