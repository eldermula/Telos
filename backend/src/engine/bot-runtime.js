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
const {
  REAL_TRADING_ENABLED,
  REAL_TRADING_ALLOW_DEMO,
  REAL_MAX_LOT,
  REAL_CONNECTION_MAX_AGE_HOURS,
} = require('../config/env');
const {
  resolveExecutionMode,
  resolveExpectedAccountTypeForLayer0,
} = require('./execution-mode');
const { resolveTickDispatch } = require('./tick-dispatch');
const {
  getMatchedAccountInfoForBotInstance,
} = require('./broker-account.service');
const { isConnectionFresh } = require('./connection-freshness');
const { computeRealLotSize } = require('./real-lot-sizing');
const {
  nextDailyDrawdownMarkers,
  shrinkDailyDrawdownMarkersForProfitLock,
} = require('./daily-drawdown');

/** Module 7 — flag broker place latency above this threshold (ms). */
const REAL_ORDER_LATENCY_WARN_MS = 200;

/**
 * Option 2 E.6 — ticks to wait for deal history after a ticket vanishes
 * from positions_get before escalating to status='error'. Approved: 3.
 */
const REAL_HISTORY_RETRY_TICKS = 3;

const apirsPath = path.join(__dirname, '..', '..', '..', 'bot', 'apirs', 'src');
const { evaluateEntry, resolveExit } = require(path.join(apirsPath, 'paperTradingHarness.js'));
const { computeLiveWinProbability, computeConsecutiveLosses } = require(
  path.join(apirsPath, 'learningEngine.js')
);

/** Default paper tick interval (ms). Overridable via PAPER_TICK_MS. */
const DEFAULT_TICK_MS = Number(process.env.PAPER_TICK_MS) || 2000;

function markersFromInstance(instance) {
  return {
    day: instance.daily_drawdown_day ?? null,
    startEquity:
      instance.daily_start_equity == null ? null : Number(instance.daily_start_equity),
    peakEquity:
      instance.daily_peak_equity == null ? null : Number(instance.daily_peak_equity),
  };
}

function dailyFieldsFromMarkers(markers) {
  if (!markers) {
    return {
      daily_drawdown_day: null,
      daily_start_equity: null,
      daily_peak_equity: null,
    };
  }
  return {
    daily_drawdown_day: markers.day,
    daily_start_equity: markers.startEquity,
    daily_peak_equity: markers.peakEquity,
  };
}

function markersChanged(prev, next) {
  if (!prev) return true;
  return (
    prev.day !== next.day ||
    Number(prev.startEquity) !== Number(next.startEquity) ||
    Number(prev.peakEquity) !== Number(next.peakEquity)
  );
}

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
async function logEntryDecision(
  botInstanceId,
  tradeInput,
  entryResult,
  selection,
  insertDecision = (args) => decisionLogRepository.insertDecision(args)
) {
  const selectionSummary = {
    chosen_instrument: selection.chosen_instrument,
    strategy_name: selection.strategy_name,
    strategy_id: selection.strategy_id,
  };

  if (!entryResult.tradeApproved) {
    await insertDecision({
      botInstanceId,
      decisionType: 'trade_rejected',
      triggeringCondition: entryResult.reason || 'trade_not_approved',
      details: { trade_input: tradeInput, selection: selectionSummary },
    });
    return;
  }

  await insertDecision({
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
async function logExitDecisions(
  botInstanceId,
  userId,
  previousMode,
  trace,
  hooks = {}
) {
  const insertDecision =
    hooks.insertDecision || ((args) => decisionLogRepository.insertDecision(args));
  const publish =
    hooks.publishBotEvent || ((id, type, payload) => publishBotEvent(id, type, payload));
  const maybeNotify =
    hooks.maybeNotifyUser ||
    ((uid, type, message) => notificationsService.maybeNotifyUser(uid, type, message));

  await insertDecision({
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
    await insertDecision({
      botInstanceId,
      decisionType: 'micro_circuit_breaker',
      triggeringCondition: 'micro circuit breaker forced emergency floor',
      details: { micro: trace.riskResult.microResult },
    });
  }

  const newMode = trace.modeResult?.activeStrategyMode;
  if (newMode && newMode !== previousMode) {
    await insertDecision({
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
    await publish(botInstanceId, 'strategy.switched', {
      from: previousMode,
      to: newMode,
      reason: `${previousMode} → ${newMode}`,
      timestamp: new Date().toISOString(),
    });
    // FR-NOTIF-3 — preference-gated persistence; paper-mode side effect only.
    await maybeNotify(
      userId,
      'strategy_switch',
      `Strategy switched ${previousMode} → ${newMode}.`
    );
  }

  if (trace.macroResult && newMode && newMode !== previousMode) {
    await insertDecision({
      botInstanceId,
      decisionType: 'macro_circuit_breaker',
      triggeringCondition: `macro mode change ${previousMode} → ${newMode}`,
      details: { macro: trace.macroResult },
    });
  }

  if (trace.profitLockResult?.profitLockTriggered) {
    await insertDecision({
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
    // Option 2 E.5/E.6 — optional seams for mocked unit tests. Production
    // leaves these unset and uses the real modules below.
    this._realOpen = {
      getMatchedAccountInfo:
        options.getMatchedAccountInfoForBotInstance || getMatchedAccountInfoForBotInstance,
      getSymbolInfo: options.getSymbolInfo || ((symbol) => mt5Connector.getSymbolInfo(symbol)),
      getPositions:
        options.getPositions || ((symbol) => mt5Connector.getPositions(symbol)),
      getOrderHistory:
        options.getOrderHistory || ((ticket) => mt5Connector.getOrderHistory(ticket)),
      placeOrder: options.placeOrder || ((args) => mt5Connector.placeOrder(args)),
      insertOpenRealTrade:
        options.insertOpenRealTrade || ((args) => tradesRepository.insertOpenRealTrade(args)),
      closeRealTrade:
        options.closeRealTrade ||
        ((tradeId, args) => tradesRepository.closeRealTrade(tradeId, args)),
      insertDecision:
        options.insertDecision || ((args) => decisionLogRepository.insertDecision(args)),
      forceNotifyUser:
        options.forceNotifyUser ||
        ((userId, type, message) => notificationsService.forceNotifyUser(userId, type, message)),
      maybeNotifyUser:
        options.maybeNotifyUser ||
        ((userId, type, message) => notificationsService.maybeNotifyUser(userId, type, message)),
      updateStatusFields:
        options.updateStatusFields ||
        ((id, fields) => botInstanceRepository.updateStatusFields(id, fields)),
      setStatus: options.setStatus || ((row) => botStatusCache.setStatus(row)),
      publishBotEvent: options.publishBotEvent || publishBotEvent,
      getTierRows: options.getTierRows || (() => riskTierConfigService.getTierRows()),
      now: options.now || (() => new Date()),
      maxLot: options.maxLot ?? REAL_MAX_LOT,
      maxAgeHours: options.maxAgeHours ?? REAL_CONNECTION_MAX_AGE_HOURS,
      historyRetryTicks: options.historyRetryTicks ?? REAL_HISTORY_RETRY_TICKS,
      listOpenTradesForResume:
        options.listOpenTradesForResume ||
        ((botInstanceId) => tradesRepository.listOpenTradesForResume(botInstanceId)),
      loadTradeHistoryForLearning:
        options.loadTradeHistoryForLearning ||
        ((botInstanceId) => tradesRepository.loadTradeHistoryForLearning(botInstanceId)),
      findInstanceById:
        options.findInstanceById || ((id) => botInstanceRepository.findById(id)),
    };
    this.timer = null;
    this.running = false;
    this.state = null;
    this.openPosition = null;
    this.dailyDrawdownMarkers = null;
    this._tickInFlight = false;
    // Set by _haltRealOpenFailure — start() must not re-arm after a halt.
    this._halted = false;
  }

  /**
   * Refresh UTC-day peak markers from a known equity reading.
   * Persists only when markers change (rollover / new peak).
   * @returns {{ markers: object, dailyDrawdownPct: number, rolledOver: boolean }}
   */
  async _refreshDailyDrawdown(currentEquity, { now, persist = true } = {}) {
    const deps = this._realOpen;
    const prev = this.dailyDrawdownMarkers;
    const result = nextDailyDrawdownMarkers({
      now: now || deps.now(),
      currentEquity,
      markers: prev,
    });
    this.dailyDrawdownMarkers = result.markers;
    if (persist && markersChanged(prev, result.markers)) {
      await deps.updateStatusFields(
        this.botInstanceId,
        dailyFieldsFromMarkers(result.markers)
      );
    }
    return result;
  }

  /**
   * Mirror profit-lock Peak Reset Vector onto daily markers so a lock
   * cannot look like a same-day crash to the micro breaker.
   */
  _shrinkDailyDrawdownForProfitLock(trace, currentEquity) {
    if (!trace?.profitLockResult?.profitLockTriggered) {
      return false;
    }
    const next = shrinkDailyDrawdownMarkersForProfitLock({
      markers: this.dailyDrawdownMarkers,
      lockedProfitAmount: trace.profitLockResult.lockedProfitAmount,
      currentEquity,
    });
    this.dailyDrawdownMarkers = next;
    return true;
  }

  async initialize() {
    const deps = this._realOpen;
    const instance = await deps.findInstanceById(this.botInstanceId);
    if (!instance) {
      throw new Error(`Bot instance ${this.botInstanceId} not found`);
    }
    const tradeHistory = await deps.loadTradeHistoryForLearning(this.botInstanceId);
    this.state = instanceToApirsState(instance, tradeHistory);
    this.dailyDrawdownMarkers = markersFromInstance(instance);

    // Resume a position left open across a process restart. Paper:
    // rebuild from the DB row (no broker). Real (E.7): reconcile
    // against the broker before the first tick — ticket present →
    // resume; absent → close-reconcile immediately.
    const openTrades = await deps.listOpenTradesForResume(this.botInstanceId);
    if (openTrades.length > 0) {
      await this._resumeOpenTrade(openTrades[0], tradeHistory);
    }
  }

  /**
   * Rebuild in-memory openPosition from a persisted open trade row.
   * Shared shape for paper resume and real-ticket-present resume.
   */
  _buildResumedOpenPosition(row, tradeHistory, { executionMode, brokerTicket, historyRetryCount }) {
    const appliedRisk = Number(row.final_applied_position_risk);
    return {
      tradeRowId: row.id,
      symbol: row.symbol,
      direction: row.direction,
      entryPrice: Number(row.entry_price),
      stopPrice: Number(row.stop_price),
      targetPrice: Number(row.target_price),
      executionMode,
      brokerTicket,
      conditions: row.conditions ?? null,
      historyRetryCount,
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

  async _resumeOpenTrade(row, tradeHistory) {
    if (row.execution_mode === 'real') {
      await this._resumeRealOpenTrade(row, tradeHistory);
      return;
    }
    this.openPosition = this._buildResumedOpenPosition(row, tradeHistory, {
      executionMode: 'paper',
      brokerTicket: null,
      historyRetryCount: 0,
    });
  }

  /**
   * Option 2 E.7 — reconcile a DB-open real trade against the broker
   * before the first tick. Ticket still open → resume. Gone → sync
   * history retries then close-reconcile (or halt).
   */
  async _resumeRealOpenTrade(row, tradeHistory) {
    const deps = this._realOpen;
    const brokerTicket = row.broker_ticket == null ? null : Number(row.broker_ticket);
    if (brokerTicket == null) {
      await this._haltRealOpenFailure('real_resume_missing_ticket', {
        trade_id: row.id,
        symbol: row.symbol,
      });
      return;
    }

    const pos = this._buildResumedOpenPosition(row, tradeHistory, {
      executionMode: 'real',
      brokerTicket,
      historyRetryCount: 0,
    });

    let positions;
    try {
      positions = await deps.getPositions(pos.symbol);
    } catch (err) {
      await this._haltRealOpenFailure('real_resume_positions_unavailable', {
        broker_ticket: brokerTicket,
        trade_id: row.id,
        message: err.message,
      });
      return;
    }

    const stillOpen = (positions || []).some(
      (p) => Number(p.ticket) === Number(brokerTicket)
    );
    if (stillOpen) {
      this.openPosition = pos;
      return;
    }

    // Closed while we were down — reconcile before first tick.
    const history = await this._fetchOrderHistoryWithRetries(brokerTicket, {
      context: 'real_resume',
      tradeId: row.id,
    });
    if (!history) {
      return; // halted inside retry helper
    }

    this.openPosition = pos;
    await this._applyRealCloseFromHistory(pos, history);
  }

  /**
   * Sync history fetch with up to historyRetryTicks attempts.
   * On exhaustion: halt and return null (no invented PnL).
   */
  async _fetchOrderHistoryWithRetries(brokerTicket, { context, tradeId }) {
    const deps = this._realOpen;
    const maxRetries = deps.historyRetryTicks;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        return await deps.getOrderHistory(brokerTicket);
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries) {
          console.warn(
            `[bot-runtime] ${context} history lag for ticket ${brokerTicket} ` +
              `(${attempt}/${maxRetries}): ${err.message}`
          );
        }
      }
    }
    await this._haltRealOpenFailure('order_history_unavailable', {
      broker_ticket: brokerTicket,
      trade_id: tradeId,
      retries: maxRetries,
      max_retries: maxRetries,
      message: lastErr ? lastErr.message : 'unknown',
      status: lastErr
        ? lastErr.statusCode || lastErr.status || lastErr.details?.status || null
        : null,
      context,
    });
    return null;
  }

  start() {
    // E.7 — initialize() may have halted on resume reconcile failure;
    // do not flip running back on and start the tick loop.
    if (this._halted) return;
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
      const { resolvedMode, haltNewOpens } = await this._resolveTickContext();
      const dispatch = resolveTickDispatch({
        resolvedMode,
        openPosition: this.openPosition,
        haltNewOpens,
      });
      switch (dispatch) {
        case 'monitorPaper':
          return await this._monitorOpenPositionPaper();
        case 'monitorReal':
          return await this._monitorOpenPositionReal();
        case 'skipOpen':
          // Soft-halt: keep the loop (and any later monitor ticks) alive.
          return null;
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
   * live_trading_confirmed_at + halt_new_opens from Postgres every tick
   * (not cached at Start), plus the two env flags.
   */
  async _resolveTickContext() {
    const instance = await this._realOpen.findInstanceById(this.botInstanceId);
    if (!instance) {
      return { resolvedMode: 'paper', haltNewOpens: false };
    }
    return {
      resolvedMode: resolveExecutionMode({
        realTradingEnabled: REAL_TRADING_ENABLED,
        accountType: instance.account_type,
        liveTradingConfirmedAt: instance.live_trading_confirmed_at,
        allowDemoRealExecution: REAL_TRADING_ALLOW_DEMO,
      }),
      haltNewOpens: instance.halt_new_opens === true,
    };
  }

  /** @deprecated use _resolveTickContext — kept for any external callers/tests */
  async _resolveExecutionModeForTick() {
    const { resolvedMode } = await this._resolveTickContext();
    return resolvedMode;
  }

  /**
   * Option 2 E.5 — real open path. Syncs live equity, sizes against it,
   * places via the connector with Layer 0's *detected* account type
   * (never the dispatch-mode string), persists broker_ticket, and
   * fails loud to status='error' on place/precondition failure.
   */
  async _maybeOpenPositionReal() {
    const deps = this._realOpen;
    let accountInfo;
    try {
      accountInfo = await deps.getMatchedAccountInfo(this.botInstanceId);
    } catch (err) {
      await this._haltRealOpenFailure('account_info_unavailable', {
        message: err.message,
        code: err.code || null,
      });
      return { state: this.state, entryResult: null, trade: null, error: true };
    }

    // Freshness before equity persist — a stale connection must not
    // rewrite the ledger or reach placeOrder.
    if (!isConnectionFresh(accountInfo.last_validated_at, deps.maxAgeHours, deps.now())) {
      await this._haltRealOpenFailure('stale_broker_connection', {
        last_validated_at: accountInfo.last_validated_at,
        max_age_hours: deps.maxAgeHours,
      });
      return { state: this.state, entryResult: null, trade: null, error: true };
    }

    const equity = Number(accountInfo.equity);
    if (!(equity > 0)) {
      await this._haltRealOpenFailure('invalid_live_equity', {
        equity: accountInfo.equity,
      });
      return { state: this.state, entryResult: null, trade: null, error: true };
    }

    this.state.balance = equity;
    this.state.peakEquity = Math.max(Number(this.state.peakEquity) || 0, equity);
    const dd = await this._refreshDailyDrawdown(equity, { persist: false });
    const synced = await deps.updateStatusFields(this.botInstanceId, {
      active_trading_balance: this.state.balance,
      peak_equity: this.state.peakEquity,
      ...dailyFieldsFromMarkers(dd.markers),
    });
    await deps.setStatus(synced);
    await deps.publishBotEvent(this.botInstanceId, 'equity.updated', {
      active_trading_balance: this.state.balance,
      peak_equity: this.state.peakEquity,
      timestamp: new Date().toISOString(),
    });

    // Layer 0 — true detected type from the live connector read.
    // Must NEVER be derived from resolveExecutionMode()'s 'real' dispatch.
    const expectedAccountType = resolveExpectedAccountTypeForLayer0(
      accountInfo.account_type
    );

    const selection = await this.strategySelection.selectTradeAcrossWatchlist();
    if (!selection) {
      return null;
    }

    const tradeInput = {
      strategyConfidence: selection.strategy_confidence,
      marketQuality: selection.newsIntelligence?.market_quality ?? 0.5,
      trendQuality: selection.marketIntelligence.trend_quality,
      marketVolatility: selection.marketIntelligence.market_volatility,
      currentATR: selection.marketIntelligence.diagnostics.currentATR,
      rollingAvgATR: selection.marketIntelligence.diagnostics.rollingAvgATR,
      dailyDrawdownPct: dd.dailyDrawdownPct,
      direction: selection.direction,
    };

    const tierRows = await deps.getTierRows();
    const entryResult = evaluateEntry(this.state, tradeInput, { tierRows });
    await logEntryDecision(
      this.botInstanceId,
      tradeInput,
      entryResult,
      selection,
      deps.insertDecision
    );

    if (!entryResult.tradeApproved) {
      return { state: this.state, entryResult, trade: null };
    }

    const symbol = selection.chosen_instrument;
    let symbolInfo;
    try {
      symbolInfo = await deps.getSymbolInfo(symbol);
    } catch (err) {
      console.error('[bot-runtime] real open price fetch failed, will retry next tick:', err.message);
      return null;
    }
    if (symbolInfo.bid == null || symbolInfo.ask == null) {
      console.error(
        '[bot-runtime] MT5 returned no live tick for',
        symbol,
        '- will retry next tick'
      );
      return null;
    }

    const direction = selection.direction;
    const quoteEntry = direction === 'BUY' ? symbolInfo.ask : symbolInfo.bid;
    const { stopPrice, targetPrice } = strategySelectionService.computeSelectionStopTarget(
      selection,
      quoteEntry
    );

    let lotSizing;
    try {
      lotSizing = computeRealLotSize({
        equity,
        appliedRisk: entryResult.riskResult.appliedRisk,
        entryPrice: quoteEntry,
        stopPrice,
        symbol,
        symbolInfo,
        maxLot: deps.maxLot,
      });
    } catch (err) {
      await this._haltRealOpenFailure('lot_sizing_failed', {
        message: err.message,
        symbol,
        equity,
        applied_risk: entryResult.riskResult.appliedRisk,
      });
      return { state: this.state, entryResult, trade: null, error: true };
    }

    const conditions = {
      ...tradeInput,
      strategy_id: selection.strategy_id,
      strategy_name: selection.strategy_name,
    };

    const placeStarted = Date.now();
    let placeResult;
    try {
      placeResult = await deps.placeOrder({
        symbol,
        direction,
        volume: lotSizing.lotSize,
        sl: stopPrice,
        tp: targetPrice,
        expectedAccountType,
      });
    } catch (err) {
      const latencyMs = Date.now() - placeStarted;
      await this._haltRealOpenFailure('place_order_failed', {
        message: err.message,
        code: err.code || null,
        details: err.details || null,
        symbol,
        direction,
        volume: lotSizing.lotSize,
        expected_account_type: expectedAccountType,
        detected_account_type: accountInfo.account_type,
        latency_ms: latencyMs,
      });
      return { state: this.state, entryResult, trade: null, error: true };
    }

    const latencyMs = Date.now() - placeStarted;
    const brokerTicket = placeResult.ticket;
    const entryPrice =
      placeResult.price != null && Number(placeResult.price) > 0
        ? Number(placeResult.price)
        : quoteEntry;
    const lotSize =
      placeResult.volume != null && Number(placeResult.volume) > 0
        ? Number(placeResult.volume)
        : lotSizing.lotSize;

    const tradeRow = await deps.insertOpenRealTrade({
      botInstanceId: this.botInstanceId,
      symbol,
      direction,
      entryPrice,
      stopPrice,
      targetPrice,
      lotSize,
      finalAppliedPositionRisk: entryResult.riskResult.appliedRisk,
      brokerTicket,
      conditions,
    });

    this.openPosition = {
      tradeRowId: tradeRow.id,
      symbol,
      direction,
      entryPrice,
      stopPrice,
      targetPrice,
      executionMode: 'real',
      brokerTicket: Number(brokerTicket),
      conditions,
      entryResult,
      historyRetryCount: 0,
    };

    await deps.insertDecision({
      botInstanceId: this.botInstanceId,
      decisionType: 'real_order_placed',
      triggeringCondition: `${direction} ${symbol} ticket=${brokerTicket} lots=${lotSize}`,
      details: {
        trade_id: tradeRow.id,
        broker_ticket: brokerTicket,
        symbol,
        direction,
        lot_size: lotSize,
        entry_price: entryPrice,
        stop_price: stopPrice,
        target_price: targetPrice,
        expected_account_type: expectedAccountType,
        detected_account_type: accountInfo.account_type,
        lot_sizing: lotSizing,
        latency_ms: latencyMs,
        latency_flagged: latencyMs > REAL_ORDER_LATENCY_WARN_MS,
      },
    });

    if (latencyMs > REAL_ORDER_LATENCY_WARN_MS) {
      console.warn(
        `[bot-runtime] real placeOrder latency ${latencyMs}ms exceeds ${REAL_ORDER_LATENCY_WARN_MS}ms`,
        { botInstanceId: this.botInstanceId, brokerTicket }
      );
    }

    await deps.forceNotifyUser(
      this.userId,
      'real_order',
      `Real order placed: ${direction} ${symbol} ticket ${brokerTicket} (${lotSize} lots).`
    );

    await deps.publishBotEvent(this.botInstanceId, 'trade.opened', tradeRow);

    return { state: this.state, entryResult, trade: tradeRow };
  }

  /**
   * Halt the runtime after a real-mode open/monitor/resume hard failure.
   * Does not go through stop()'s 'stopped' publish — status stays 'error'.
   */
  async _haltRealOpenFailure(reason, details) {
    this._halted = true;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    try {
      await this._realOpen.insertDecision({
        botInstanceId: this.botInstanceId,
        decisionType: 'real_order_failed',
        triggeringCondition: reason,
        details: details || {},
      });
    } catch (err) {
      console.error('[bot-runtime] real_order_failed log failed:', err.message);
    }

    try {
      await this._realOpen.forceNotifyUser(
        this.userId,
        'real_order',
        `Real order failed (${reason}). Bot stopped in error — investigate before Start.`
      );
    } catch (err) {
      console.error('[bot-runtime] real_order_failed notify failed:', err.message);
    }

    try {
      const updated = await this._realOpen.updateStatusFields(this.botInstanceId, {
        status: 'error',
      });
      await this._realOpen.setStatus(updated);
      await this._realOpen.publishBotEvent(this.botInstanceId, 'bot.status_changed', {
        status: 'error',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[bot-runtime] failed to persist error status:', err.message);
    }

    runtimes.delete(this.botInstanceId);
  }

  /**
   * Option 2 E.6 — real monitor path. Broker already holds SL/TP; this
   * tick only *detects* close (ticket gone from positions) and
   * reconciles via order history. No local stop/target comparison.
   */
  async _monitorOpenPositionReal() {
    const deps = this._realOpen;
    const pos = this.openPosition;
    if (!pos || pos.executionMode !== 'real' || pos.brokerTicket == null) {
      await this._haltRealOpenFailure('real_monitor_missing_position', {
        openPosition: pos
          ? {
              executionMode: pos.executionMode,
              brokerTicket: pos.brokerTicket ?? null,
              tradeRowId: pos.tradeRowId ?? null,
            }
          : null,
      });
      return { state: this.state, trade: null, error: true };
    }

    let positions;
    try {
      positions = await deps.getPositions(pos.symbol);
    } catch (err) {
      // Transient connector blip — retry next tick, do not invent a close.
      console.error(
        '[bot-runtime] real monitor getPositions failed, will retry next tick:',
        err.message
      );
      return null;
    }

    const stillOpen = (positions || []).some(
      (p) => Number(p.ticket) === Number(pos.brokerTicket)
    );
    if (stillOpen) {
      pos.historyRetryCount = 0;
      return null;
    }

    // Ticket gone — broker closed (SL/TP, manual, stop-out). Reconcile.
    let history;
    try {
      history = await deps.getOrderHistory(pos.brokerTicket);
    } catch (err) {
      const retries = (pos.historyRetryCount || 0) + 1;
      pos.historyRetryCount = retries;
      const maxRetries = deps.historyRetryTicks;
      if (retries < maxRetries) {
        console.warn(
          `[bot-runtime] real monitor history lag for ticket ${pos.brokerTicket} ` +
            `(${retries}/${maxRetries}): ${err.message}`
        );
        return null;
      }
      await this._haltRealOpenFailure('order_history_unavailable', {
        broker_ticket: pos.brokerTicket,
        trade_id: pos.tradeRowId,
        retries,
        max_retries: maxRetries,
        message: err.message,
        status: err.statusCode || err.status || err.details?.status || null,
      });
      return { state: this.state, trade: null, error: true };
    }

    return this._applyRealCloseFromHistory(pos, history);
  }

  /**
   * Shared real close-reconcile (E.6 monitor + E.7 resume-absent).
   * Broker PnL only — never invent exit/pnl.
   */
  async _applyRealCloseFromHistory(pos, history) {
    const deps = this._realOpen;
    const exitPrice = Number(history.close_price);
    const pnlAmount = Number(history.profit);
    if (!(exitPrice > 0) || !Number.isFinite(pnlAmount)) {
      await this._haltRealOpenFailure('order_history_incomplete', {
        broker_ticket: pos.brokerTicket,
        history,
      });
      return { state: this.state, trade: null, error: true };
    }

    const wasWin = pnlAmount > 0;
    const closedAt =
      history.close_time != null && Number(history.close_time) > 0
        ? new Date(Number(history.close_time) * 1000)
        : new Date();

    const tierRows = await deps.getTierRows();
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
    this._shrinkDailyDrawdownForProfitLock(trace, nextState.balance);

    const closedTrade = await deps.closeRealTrade(pos.tradeRowId, {
      exitPrice,
      pnl: pnlAmount,
      closedAt,
    });

    await logExitDecisions(this.botInstanceId, this.userId, previousMode, trace, {
      insertDecision: deps.insertDecision,
      publishBotEvent: deps.publishBotEvent,
      maybeNotifyUser: deps.maybeNotifyUser,
    });

    await deps.insertDecision({
      botInstanceId: this.botInstanceId,
      decisionType: 'real_order_closed',
      triggeringCondition: `ticket=${pos.brokerTicket} pnl=${pnlAmount}`,
      details: {
        trade_id: pos.tradeRowId,
        broker_ticket: pos.brokerTicket,
        symbol: pos.symbol,
        direction: pos.direction,
        exit_price: exitPrice,
        pnl: pnlAmount,
        was_win: wasWin,
        history,
      },
    });

    await deps.forceNotifyUser(
      this.userId,
      'real_order',
      `Real order closed: ${pos.direction} ${pos.symbol} ticket ${pos.brokerTicket} pnl ${pnlAmount}.`
    );

    if (closedTrade) {
      await deps.publishBotEvent(this.botInstanceId, 'trade.closed', closedTrade);
    }

    // Broker equity is source of truth after a real close.
    try {
      const accountInfo = await deps.getMatchedAccountInfo(this.botInstanceId);
      const equity = Number(accountInfo.equity);
      if (equity > 0) {
        this.state.balance = equity;
        this.state.peakEquity = Math.max(Number(this.state.peakEquity) || 0, equity);
      }
    } catch (err) {
      console.error(
        '[bot-runtime] post-close equity sync failed, keeping APIRS state:',
        err.message
      );
    }

    // After resume-close, instance may still be 'stopped' until Start
    // finishes — keep status running only when we were already running
    // (monitor path). On initialize reconcile, leave status alone if
    // still stopped; Start's caller sets running afterward.
    // Refresh daily markers from final equity (broker sync may have moved it).
    const ddClose = await this._refreshDailyDrawdown(this.state.balance, { persist: false });
    const statusFields = {
      active_strategy_mode: nextState.activeStrategyMode,
      active_trading_balance: this.state.balance,
      peak_equity: this.state.peakEquity,
      current_tier: nextState.currentTier,
      ...dailyFieldsFromMarkers(ddClose.markers),
    };
    if (this.running) {
      statusFields.status = 'running';
    }

    const updated = await deps.updateStatusFields(this.botInstanceId, statusFields);
    const cached = await deps.setStatus(updated);

    await deps.publishBotEvent(this.botInstanceId, 'equity.updated', {
      active_trading_balance: cached.active_trading_balance,
      peak_equity: cached.peak_equity,
      timestamp: cached.updated_at,
    });

    this.openPosition = null;

    return { state: this.state, trace, trade: closedTrade, session: cached };
  }

  async _maybeOpenPositionPaper() {
    // Daily drawdown for micro breaker — update peak-of-day whenever we
    // have a known paper equity, before Selection (so a no-signal tick
    // still advances the high-water mark).
    const dd = await this._refreshDailyDrawdown(this.state.balance);

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
      dailyDrawdownPct: dd.dailyDrawdownPct,
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
    this._shrinkDailyDrawdownForProfitLock(trace, nextState.balance);
    const ddPaperClose = await this._refreshDailyDrawdown(nextState.balance, {
      persist: false,
    });

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
      ...dailyFieldsFromMarkers(ddPaperClose.markers),
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
    if (!existing.running && !existing._halted) {
      await existing.initialize();
      existing.start();
    }
    return existing;
  }
  const runtime = new BotRuntime(instance, options);
  await runtime.initialize();
  // E.7 — resume reconcile may have halted (status=error). Still
  // register the runtime so Stop/status paths can see it, but do not
  // start the tick loop (start() also no-ops when _halted).
  runtimes.set(instance.id, runtime);
  runtime.start();
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
};
