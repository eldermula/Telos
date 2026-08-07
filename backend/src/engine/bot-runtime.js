'use strict';

const path = require('path');
const botInstanceRepository = require('./bot-instance.repository');
const botStatusCache = require('./bot-status.cache');
const decisionLogRepository = require('./decision-log.repository');
const tradesRepository = require('./trades.repository');
const { publishBotEvent } = require('./event-publisher');
const mt5Connector = require('../services/mt5-connector.client');
const strategySelectionService = require('./strategy-selection.service');
const notificationsService = require('../services/notifications.service');
const riskTierConfigService = require('./risk-tier-config.service');
const { REAL_TRADING_ENABLED, REAL_TRADING_ALLOW_DEMO } = require('../config/env');
const { resolveExecutionMode } = require('./execution-mode');
const { resolveTickDispatch } = require('./tick-dispatch');

const apirsPath = path.join(__dirname, '..', '..', '..', 'bot', 'apirs', 'src');
const { evaluateEntry, resolveExit } = require(path.join(apirsPath, 'paperTradingHarness.js'));
const { computeLiveWinProbability, computeConsecutiveLosses } = require(
  path.join(apirsPath, 'learningEngine.js')
);

/** Default paper tick interval (ms). Overridable via PAPER_TICK_MS. */
const DEFAULT_TICK_MS = Number(process.env.PAPER_TICK_MS) || 2000;

/**
 * 08_Bot_Architecture.md Section 2's stub — `daily_drawdown_pct` isn't
 * one of Modules 2-4's outputs (it's an account-level "how far down
 * are we today" metric), and giving it a real computation needs its
 * own design (day-boundary definition, timezone, peak-of-day vs.
 * start-of-day baseline) unrelated to Selection's signals. Explicitly
 * deferred past 6.4 — flagged, not silently left stubbed.
 */
const STUB_DAILY_DRAWDOWN_PCT = 0.02;

function instanceToApirsState(instance, tradeHistory) {
  return {
    balance: Number(instance.active_trading_balance),
    peakEquity: Number(instance.peak_equity),
    activeStrategyMode: instance.active_strategy_mode,
    currentTier: instance.current_tier,
    initialBalance: Number(instance.initial_balance),
    tradeHistory,
  };
}

/**
 * Logged when APIRS approves or rejects opening a new position.
 * `selection` (6.4) is Module 4's chosen_instrument/strategy_name —
 * carried into the decision log even on rejection, so the Decision
 * Log UI can show *which* instrument/strategy Selection had picked
 * before APIRS said no, not just that something was rejected.
 */
async function logEntryDecision(botInstanceId, tradeInput, entryResult, selection) {
  const selectionSummary = {
    chosen_instrument: selection.chosen_instrument,
    strategy_name: selection.strategy_name,
    strategy_id: selection.strategy_id,
  };

  if (!entryResult.tradeApproved) {
    await decisionLogRepository.insertDecision({
      botInstanceId,
      decisionType: 'trade_rejected',
      triggeringCondition: entryResult.reason || 'trade_not_approved',
      details: { trade_input: tradeInput, selection: selectionSummary },
    });
    return;
  }

  await decisionLogRepository.insertDecision({
    botInstanceId,
    decisionType: 'trade_approved',
    triggeringCondition: `${tradeInput.direction} ${selection.chosen_instrument} opened via ${selection.strategy_name}, applied_risk=${entryResult.riskResult.appliedRisk}`,
    details: {
      trade_input: tradeInput,
      selection: selectionSummary,
      risk_result: {
        appliedRisk: entryResult.riskResult.appliedRisk,
        riskSource: entryResult.riskResult.riskSource,
      },
    },
  });
}

/**
 * Logged once an open position resolves against real price. Covers what
 * `persistDecisionsFromTrace` used to log in one shot back when a trade
 * opened and closed in the same tick — now split because opening and
 * resolving are separate events in time.
 */
async function logExitDecisions(botInstanceId, userId, previousMode, trace) {
  await decisionLogRepository.insertDecision({
    botInstanceId,
    decisionType: 'trade_closed',
    triggeringCondition: `resolved pnl=${trace.pnlAmount}`,
    details: {
      pnl_amount: trace.pnlAmount,
      balance_before: trace.balanceBeforeTrade,
      balance_after: trace.balanceAfterTrade,
      was_win: trace.wasWin,
    },
  });

  if (trace.riskResult?.microResult?.forcedToEmergencyFloor) {
    await decisionLogRepository.insertDecision({
      botInstanceId,
      decisionType: 'micro_circuit_breaker',
      triggeringCondition: 'micro circuit breaker forced emergency floor',
      details: { micro: trace.riskResult.microResult },
    });
  }

  const newMode = trace.modeResult?.activeStrategyMode;
  if (newMode && newMode !== previousMode) {
    await decisionLogRepository.insertDecision({
      botInstanceId,
      decisionType: 'strategy_switch',
      triggeringCondition: `${previousMode} → ${newMode}`,
      details: {
        from: previousMode,
        to: newMode,
        macro: trace.macroResult || null,
        mode: trace.modeResult || null,
      },
    });
    await publishBotEvent(botInstanceId, 'strategy.switched', {
      from: previousMode,
      to: newMode,
      reason: `${previousMode} → ${newMode}`,
      timestamp: new Date().toISOString(),
    });
    // FR-NOTIF-3 — preference-gated persistence; paper-mode side effect only.
    await notificationsService.maybeNotifyUser(
      userId,
      'strategy_switch',
      `Strategy switched ${previousMode} → ${newMode}.`
    );
  }

  if (trace.macroResult && newMode && newMode !== previousMode) {
    await decisionLogRepository.insertDecision({
      botInstanceId,
      decisionType: 'macro_circuit_breaker',
      triggeringCondition: `macro mode change ${previousMode} → ${newMode}`,
      details: { macro: trace.macroResult },
    });
  }

  if (trace.profitLockResult?.profitLockTriggered) {
    await decisionLogRepository.insertDecision({
      botInstanceId,
      decisionType: 'profit_lock',
      triggeringCondition: 'profit lock triggered',
      details: { profit_lock: trace.profitLockResult },
    });
  }
}

class BotRuntime {
  /**
   * @param {object} instance - bot_instances row
   * @param {{ tickMs?: number, autoTick?: boolean, strategySelection?: object }} [options]
   *   `strategySelection` defaults to the real Module 4 orchestration
   *   service — overridable so tests can inject a deterministic
   *   selection instead of depending on live market timing (real
   *   crossover/breakout/RSI-extreme signals are edge-triggered and
   *   won't reliably fire within a short test window; the live
   *   Module 4 wiring itself is already verified independently by
   *   smoke-strategy-selection-64.js).
   */
  constructor(instance, options = {}) {
    this.botInstanceId = instance.id;
    this.userId = instance.user_id;
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.autoTick = options.autoTick !== false;
    this.strategySelection = options.strategySelection || strategySelectionService;
    this.timer = null;
    this.running = false;
    this.state = null;
    this.openPosition = null;
    this._tickInFlight = false;
  }

  async initialize() {
    const instance = await botInstanceRepository.findById(this.botInstanceId);
    if (!instance) {
      throw new Error(`Bot instance ${this.botInstanceId} not found`);
    }
    const tradeHistory = await tradesRepository.loadTradeHistoryForLearning(this.botInstanceId);
    this.state = instanceToApirsState(instance, tradeHistory);

    // Resume a position left open across a process restart (paper mode
    // only — no real capital at stake). The exact entryResult from the
    // original tick isn't persisted, so this rebuilds an approximation
    // from the trade row + current state rather than the original
    // learning/risk snapshot. This doesn't depend on Module 4's real
    // signals either way (it reads back already-persisted direction/
    // prices/risk, not tradeInput) — flagged as a known simplification,
    // accepted as permanent unless real capital is ever introduced.
    const openTrades = await tradesRepository.listOpenTradesForResume(this.botInstanceId);
    if (openTrades.length > 0) {
      const row = openTrades[0];
      const appliedRisk = Number(row.final_applied_position_risk);
      // Option 2 E.4 — freeze the row's execution_mode onto the
      // in-memory position so monitoring dispatches correctly after
      // resume. Real-mode reconcile against the broker is E.7.
      this.openPosition = {
        tradeRowId: row.id,
        symbol: row.symbol,
        direction: row.direction,
        entryPrice: Number(row.entry_price),
        stopPrice: Number(row.stop_price),
        targetPrice: Number(row.target_price),
        executionMode: row.execution_mode === 'real' ? 'real' : 'paper',
        brokerTicket: row.broker_ticket == null ? null : Number(row.broker_ticket),
        // Read back verbatim (006) — already fully known at open time,
        // no reconstruction needed, same as symbol/direction above.
        conditions: row.conditions ?? null,
        entryResult: {
          tradeApproved: true,
          learningInputs: {
            liveWinProbability: computeLiveWinProbability(tradeHistory),
            consecutiveLosses: computeConsecutiveLosses(tradeHistory),
          },
          riskResult: { appliedRisk, riskSource: 'resumed_after_restart' },
          balanceBeforeTrade: this.state.balance,
          riskedAmount: appliedRisk * this.state.balance,
        },
      };
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    // Fire-and-forget — start() is sync; publish is async
    publishBotEvent(this.botInstanceId, 'bot.status_changed', {
      status: 'running',
      timestamp: new Date().toISOString(),
    }).catch((err) => console.error('[bot-runtime]', err.message));
    if (this.autoTick) {
      this.timer = setInterval(() => {
        this.tickOnce().catch((err) => {
          console.error('[bot-runtime]', this.botInstanceId, err.message);
        });
      }, this.tickMs);
      if (typeof this.timer.unref === 'function') {
        this.timer.unref();
      }
    }
  }

  async stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await publishBotEvent(this.botInstanceId, 'bot.status_changed', {
      status: 'stopped',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * One tick: resolve execution mode fresh (never cached at Start),
   * then dispatch to paper or real open/monitor methods. Never both
   * open and monitor in the same tick.
   */
  async tickOnce() {
    if (!this.running) {
      return null;
    }
    if (this._tickInFlight) {
      return null;
    }
    this._tickInFlight = true;
    try {
      const resolvedMode = await this._resolveExecutionModeForTick();
      const dispatch = resolveTickDispatch({
        resolvedMode,
        openPosition: this.openPosition,
      });
      switch (dispatch) {
        case 'monitorPaper':
          return await this._monitorOpenPositionPaper();
        case 'monitorReal':
          return await this._monitorOpenPositionReal();
        case 'openReal':
          return await this._maybeOpenPositionReal();
        case 'openPaper':
        default:
          return await this._maybeOpenPositionPaper();
      }
    } finally {
      this._tickInFlight = false;
    }
  }

  /**
   * Layer 3 — per-tick freshness. Reads account_type +
   * live_trading_confirmed_at from Postgres every tick (not cached at
   * Start), plus the two env flags.
   */
  async _resolveExecutionModeForTick() {
    const instance = await botInstanceRepository.findById(this.botInstanceId);
    if (!instance) {
      return 'paper';
    }
    return resolveExecutionMode({
      realTradingEnabled: REAL_TRADING_ENABLED,
      accountType: instance.account_type,
      liveTradingConfirmedAt: instance.live_trading_confirmed_at,
      allowDemoRealExecution: REAL_TRADING_ALLOW_DEMO,
    });
  }

  /**
   * Option 2 E.5 — not implemented yet. Stub fails loud so an accidental
   * real-mode dispatch cannot silently fall through to paper.
   */
  async _maybeOpenPositionReal() {
    throw new Error('Option 2 E.5 not implemented: _maybeOpenPositionReal');
  }

  /**
   * Option 2 E.6 — not implemented yet. Stub fails loud.
   */
  async _monitorOpenPositionReal() {
    throw new Error('Option 2 E.6 not implemented: _monitorOpenPositionReal');
  }

  async _maybeOpenPositionPaper() {
    // Module 4 — Selection (08_Bot_Architecture.md Section 9.0/13):
    // evaluates every active strategy against every watchlist
    // instrument and returns at most one candidate. `null` is a
    // legitimate no-trade tick — nothing fired anywhere this
    // instant — not a failure, so it's handled exactly like APIRS
    // rejecting a trade: quietly wait for the next tick.
    const selection = await this.strategySelection.selectTradeAcrossWatchlist();
    if (!selection) {
      return null;
    }

    const tradeInput = {
      strategyConfidence: selection.strategy_confidence,
      // Module 3's fallback still returns a real (neutral) market_quality
      // for every instrument even when degraded, so this should always
      // be present — the `?? 0.5` is defensive, not an expected path.
      marketQuality: selection.newsIntelligence?.market_quality ?? 0.5,
      trendQuality: selection.marketIntelligence.trend_quality,
      marketVolatility: selection.marketIntelligence.market_volatility,
      currentATR: selection.marketIntelligence.diagnostics.currentATR,
      rollingAvgATR: selection.marketIntelligence.diagnostics.rollingAvgATR,
      dailyDrawdownPct: STUB_DAILY_DRAWDOWN_PCT,
      direction: selection.direction,
    };

    // Phase 7.8 — resolved fresh each tick (Redis-cached, ~20s TTL,
    // hardcoded-matrix fallback on failure — see risk-tier-config.service.js)
    // rather than read once at bot-instance startup, so an admin's
    // risk_tier_config edit reaches this tick's evaluation without a
    // restart. Only affects *this* not-yet-opened decision — an already
    // open position's appliedRisk was frozen into its trade record at
    // its own entry tick and is never recomputed here.
    const tierRows = await riskTierConfigService.getTierRows();

    const entryResult = evaluateEntry(this.state, tradeInput, { tierRows });
    await logEntryDecision(this.botInstanceId, tradeInput, entryResult, selection);

    if (!entryResult.tradeApproved) {
      return { state: this.state, entryResult, trade: null };
    }

    const symbol = selection.chosen_instrument;
    let symbolInfo;
    try {
      symbolInfo = await mt5Connector.getSymbolInfo(symbol);
    } catch (err) {
      console.error('[bot-runtime] price fetch failed, will retry next tick:', err.message);
      return null;
    }
    if (symbolInfo.bid == null || symbolInfo.ask == null) {
      console.error('[bot-runtime] MT5 returned no live tick for', symbol, '- will retry next tick');
      return null;
    }

    // Entry is fetched fresh here (not reused from whatever price
    // Selection last saw) since a moment may have passed between
    // Selection running and APIRS approving — stop/target are then
    // derived from *this* live entry using Selection's ATR-based
    // stop/target rule, so they're anchored to the real fill price.
    const direction = selection.direction;
    const entryPrice = direction === 'BUY' ? symbolInfo.ask : symbolInfo.bid;
    const { stopPrice, targetPrice } = strategySelectionService.computeSelectionStopTarget(selection, entryPrice);
    // Paper lot size: proportional placeholder (Module 7's real
    // per-instrument contract-size/pip-value specs are explicitly
    // deferred, confirmed this revision — P&L below is risked-dollar-
    // amount x R-multiple, not lot-size-derived, so this placeholder
    // only affects the displayed lot_size number, not the math).
    const lotSize = Number((entryResult.riskResult.appliedRisk * 0.1).toFixed(4)) || 0.01;

    // Learning Engine (08 Section 8) input — "the conditions present
    // when it opened." Same scalar tradeInput shape already built above,
    // plus the two strategy-identity fields tradeInput doesn't carry.
    // `chosen_instrument` deliberately excluded — it's already
    // trades.symbol, a first-class indexed column since 6.4; duplicating
    // it here risks the two silently diverging later for no benefit.
    // Must stay these extracted scalars, never `selection` wholesale —
    // `selection.marketIntelligence` carries the raw 100-bar OHLC array
    // (cached alongside the indicators since 6.4) and serializing that
    // would balloon every trade row with ~100 redundant bars.
    const conditions = {
      ...tradeInput,
      strategy_id: selection.strategy_id,
      strategy_name: selection.strategy_name,
    };

    const tradeRow = await tradesRepository.insertOpenPaperTrade({
      botInstanceId: this.botInstanceId,
      symbol,
      direction,
      entryPrice,
      stopPrice,
      targetPrice,
      lotSize,
      finalAppliedPositionRisk: entryResult.riskResult.appliedRisk,
      conditions,
    });

    this.openPosition = {
      tradeRowId: tradeRow.id,
      symbol,
      direction,
      entryPrice,
      stopPrice,
      targetPrice,
      executionMode: 'paper',
      brokerTicket: null,
      conditions,
      entryResult,
    };

    // 06_API_Specification.md Section 11 documents `trade.opened` /
    // `trade.closed` as a pair. Before 6.1 this never mattered — open
    // and close happened in the same tick, so `trade.closed` alone
    // covered it. Now that a position can sit open for real time
    // (Section "What was built" above), the Frontend has no other way
    // to learn a position just opened; without this, positions.tsx
    // stays stale until the position later resolves.
    await publishBotEvent(this.botInstanceId, 'trade.opened', tradeRow);

    return { state: this.state, entryResult, trade: tradeRow };
  }

  async _monitorOpenPositionPaper() {
    const pos = this.openPosition;

    let symbolInfo;
    try {
      symbolInfo = await mt5Connector.getSymbolInfo(pos.symbol);
    } catch (err) {
      console.error('[bot-runtime] price fetch failed, will retry next tick:', err.message);
      return null;
    }
    if (symbolInfo.bid == null || symbolInfo.ask == null) {
      return null;
    }

    // Exiting a position transacts on the opposite side of the book from
    // opening it — closing a BUY sells at bid, closing a SELL buys at
    // ask (matches bot/mt5-connector/server.py's real close_order logic).
    const current = pos.direction === 'BUY' ? symbolInfo.bid : symbolInfo.ask;

    let hit = null;
    if (pos.direction === 'BUY') {
      if (current >= pos.targetPrice) hit = 'target';
      else if (current <= pos.stopPrice) hit = 'stop';
    } else {
      if (current <= pos.targetPrice) hit = 'target';
      else if (current >= pos.stopPrice) hit = 'stop';
    }

    if (!hit) {
      return null; // still open — nothing resolved this tick
    }

    const exitPrice = current;
    const stopDistance = Math.abs(pos.entryPrice - pos.stopPrice);
    const signedMove = (exitPrice - pos.entryPrice) * (pos.direction === 'BUY' ? 1 : -1);
    const realRMultiple = stopDistance > 0 ? signedMove / stopDistance : 0;
    const pnlAmount = pos.entryResult.riskedAmount * realRMultiple;
    const wasWin = pnlAmount > 0;

    // Phase 7.9 — resolved fresh at close time, independently of
    // whatever tierRows the entry tick saw (see paperTradingHarness.js's
    // file-header note): profit-lock's step_size/tier-advancement isn't
    // frozen-at-entry the way appliedRisk is, so this tick's own live
    // read is the correct one, not a carried-over snapshot from open.
    const tierRows = await riskTierConfigService.getTierRows();

    const previousMode = this.state.activeStrategyMode;
    const { state: nextState, trace } = resolveExit(
      this.state,
      pos.entryResult,
      {
        wasWin,
        pnlAmount,
        conditions: pos.conditions ?? null,
      },
      { tierRows }
    );
    this.state = nextState;

    const closedTrade = await tradesRepository.closePaperTrade(pos.tradeRowId, {
      exitPrice,
      pnl: pnlAmount,
    });

    await logExitDecisions(this.botInstanceId, this.userId, previousMode, trace);

    if (closedTrade) {
      await publishBotEvent(this.botInstanceId, 'trade.closed', closedTrade);
    }

    const updated = await botInstanceRepository.updateStatusFields(this.botInstanceId, {
      status: 'running',
      active_strategy_mode: nextState.activeStrategyMode,
      active_trading_balance: nextState.balance,
      peak_equity: nextState.peakEquity,
      current_tier: nextState.currentTier,
    });
    const cached = await botStatusCache.setStatus(updated);

    await publishBotEvent(this.botInstanceId, 'equity.updated', {
      active_trading_balance: cached.active_trading_balance,
      peak_equity: cached.peak_equity,
      timestamp: cached.updated_at,
    });

    this.openPosition = null;

    return { state: nextState, trace, trade: closedTrade, session: cached };
  }
}

/** @type {Map<string, BotRuntime>} */
const runtimes = new Map();

async function startRuntime(instance, options = {}) {
  const existing = runtimes.get(instance.id);
  if (existing) {
    if (!existing.running) {
      await existing.initialize();
      existing.start();
    }
    return existing;
  }
  const runtime = new BotRuntime(instance, options);
  await runtime.initialize();
  runtime.start();
  runtimes.set(instance.id, runtime);
  return runtime;
}

async function stopRuntime(botInstanceId) {
  const runtime = runtimes.get(botInstanceId);
  if (!runtime) return;
  await runtime.stop();
  runtimes.delete(botInstanceId);
}

function getRuntime(botInstanceId) {
  return runtimes.get(botInstanceId) || null;
}

module.exports = {
  BotRuntime,
  startRuntime,
  stopRuntime,
  getRuntime,
  DEFAULT_TICK_MS,
  STUB_DAILY_DRAWDOWN_PCT,
};
