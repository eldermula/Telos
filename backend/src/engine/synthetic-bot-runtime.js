'use strict';

/**
 * Synthetics dispatcher — Volatility Indices watchlist.
 *
 * Own tick loop. Never imports bot-runtime.js or crypto-bot-runtime.js.
 * Batch 2: real open/monitor + Layer 0 + lot clamp + close reconciliation.
 *
 * Writers: trades / decision-log / WS with asset_class='synthetic'.
 * One-open is system-wide via listOpenTradesForUser + DB
 * `one_open_trade_per_user` (docs/11 §0.2) — any asset_class blocks a new open.
 * Layer 1/2 stay independently scoped per asset class.
 * News: fixed neutral (intentional exclusion — docs/11 §3).
 */

const path = require('path');
const botInstanceRepository = require('./bot-instance.repository');
const botStatusCache = require('./bot-status.cache');
const decisionLogRepository = require('./decision-log.repository');
const tradesRepository = require('./trades.repository');
const { publishBotEvent } = require('./event-publisher');
const mt5Connector = require('../services/mt5-connector.client');
const syntheticStrategySelectionService = require('./synthetic-strategy-selection.service');
const notificationsService = require('../services/notifications.service');
const riskTierConfigService = require('./risk-tier-config.service');
const { normalizeSyntheticContractSpec } = require('./synthetic-contract-specs');
const {
  nextDailyDrawdownMarkers,
  shrinkDailyDrawdownMarkersForProfitLock,
} = require('./daily-drawdown');
const {
  NODE_ENV,
  SYNTHETIC_REAL_TRADING_ENABLED,
  SYNTHETIC_REAL_TRADING_ALLOW_DEMO,
  REAL_CONNECTION_MAX_AGE_HOURS,
} = require('../config/env');
const {
  resolveExecutionMode,
  resolveExpectedAccountTypeForLayer0,
} = require('./execution-mode');
const { isConfirmationActive } = require('./live-trading-confirmation');
const { resolveTickDispatch } = require('./tick-dispatch');
const { getMatchedAccountInfoForBotInstance } = require('./broker-account.service');
const { isConnectionFresh } = require('./connection-freshness');
const { clampLotSize } = require('./synthetic-lot-clamp');
const { SYNTHETIC_WATCHLIST } = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  'bot',
  'synthetic-market-intelligence',
  'src',
  'watchlist.js'
));

const apirsPath = path.join(__dirname, '..', '..', '..', 'bot', 'apirs', 'src');
const { evaluateEntry, resolveExit } = require(path.join(apirsPath, 'paperTradingHarness.js'));
const { computeLiveWinProbability, computeConsecutiveLosses } = require(
  path.join(apirsPath, 'learningEngine.js')
);

const DEFAULT_TICK_MS =
  Number(process.env.SYNTHETIC_PAPER_TICK_MS) || Number(process.env.PAPER_TICK_MS) || 2000;
const ASSET_CLASS = 'synthetic';
const REAL_HISTORY_RETRY_TICKS = 3;
const REAL_ORDER_LATENCY_WARN_MS = 200;
/** Read-only account-info pre-check only — never used for placeOrder. */
const ACCOUNT_INFO_PRECHECK_RETRY_DELAY_MS = 400;
const SYNTHETIC_WATCHLIST_SET = new Set(SYNTHETIC_WATCHLIST);

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
    balance: Number(instance.synthetic_active_trading_balance),
    peakEquity: Number(instance.synthetic_peak_equity),
    activeStrategyMode: instance.active_strategy_mode,
    currentTier: instance.synthetic_current_tier,
    initialBalance: Number(instance.synthetic_initial_balance),
    tradeHistory,
  };
}

async function logEntryDecision(botInstanceId, tradeInput, entryResult, selection, insertDecision) {
  const write =
    insertDecision || ((args) => decisionLogRepository.insertDecision(args));
  const selectionSummary = {
    chosen_instrument: selection.chosen_instrument,
    strategy_name: selection.strategy_name,
    strategy_id: selection.strategy_id,
  };

  if (!entryResult.tradeApproved) {
    await write({
      botInstanceId,
      decisionType: 'trade_rejected',
      triggeringCondition: entryResult.reason || 'trade_not_approved',
      details: { trade_input: tradeInput, selection: selectionSummary },
      assetClass: ASSET_CLASS,
    });
    return;
  }

  await write({
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
    assetClass: ASSET_CLASS,
  });
}

async function logExitDecisions(botInstanceId, userId, previousMode, trace, deps = {}) {
  const insertDecision =
    deps.insertDecision || ((args) => decisionLogRepository.insertDecision(args));
  const publish =
    deps.publishBotEvent || publishBotEvent;
  const maybeNotify =
    deps.maybeNotifyUser ||
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
    assetClass: ASSET_CLASS,
  });

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
      assetClass: ASSET_CLASS,
    });
    await publish(botInstanceId, 'strategy.switched', {
      from: previousMode,
      to: newMode,
      reason: `${previousMode} → ${newMode}`,
      timestamp: new Date().toISOString(),
    });
    await maybeNotify(
      userId,
      'strategy_switch',
      `Strategy switched ${previousMode} → ${newMode}.`
    );
  }
}

class SyntheticBotRuntime {
  /**
   * @param {object} instance bot_instances row
   * @param {object} [options] seams for unit tests + runtime knobs
   */
  constructor(instance, options = {}) {
    this.botInstanceId = instance.id;
    this.userId = instance.user_id;
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.autoTick = options.autoTick !== false;
    this.strategySelection = options.strategySelection || syntheticStrategySelectionService;
    this._real = {
      getMatchedAccountInfo:
        options.getMatchedAccountInfoForBotInstance || getMatchedAccountInfoForBotInstance,
      getSymbolInfo: options.getSymbolInfo || ((s) => mt5Connector.getSymbolInfo(s)),
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
      maxAgeHours: options.maxAgeHours ?? REAL_CONNECTION_MAX_AGE_HOURS,
      historyRetryTicks: options.historyRetryTicks ?? REAL_HISTORY_RETRY_TICKS,
      // System-wide one-open (docs/11 §0.2) — any asset_class blocks a new open.
      listOpenTradesForUser:
        options.listOpenTradesForUser ||
        ((userId) => tradesRepository.listOpenTradesForUser(userId)),
      listOpenSyntheticTradesForResume:
        options.listOpenSyntheticTradesForResume ||
        ((id) => tradesRepository.listOpenSyntheticTradesForResume(id)),
      listOpenSyntheticRealTrades:
        options.listOpenSyntheticRealTrades ||
        ((id) => tradesRepository.listOpenSyntheticRealTrades(id)),
      findInstanceById:
        options.findInstanceById || ((id) => botInstanceRepository.findById(id)),
      loadTradeHistoryForLearning:
        options.loadTradeHistoryForLearning ||
        ((id) => tradesRepository.loadTradeHistoryForLearning(id)),
      clampLotSize: options.clampLotSize || clampLotSize,
    };
    // Back-compat for paper path tests that injected getSymbolInfo on the instance.
    this.getSymbolInfo = this._real.getSymbolInfo;
    this.timer = null;
    this.running = false;
    this.state = null;
    this.openPosition = null;
    this.dailyDrawdownMarkers = null;
    this._tickInFlight = false;
    this._halted = false;
  }

  async _refreshDailyDrawdown(currentEquity, { now, persist = true } = {}) {
    const deps = this._real;
    const prev = this.dailyDrawdownMarkers;
    const result = nextDailyDrawdownMarkers({
      now: now || deps.now(),
      currentEquity,
      markers: prev,
    });
    this.dailyDrawdownMarkers = result.markers;
    if (persist && markersChanged(prev, result.markers)) {
      await deps.updateStatusFields(this.botInstanceId, dailyFieldsFromMarkers(result.markers));
    }
    return result;
  }

  _shrinkDailyDrawdownForProfitLock(trace, currentEquity) {
    if (!trace?.profitLockResult?.profitLockTriggered) {
      return false;
    }
    this.dailyDrawdownMarkers = shrinkDailyDrawdownMarkersForProfitLock({
      markers: this.dailyDrawdownMarkers,
      lockedProfitAmount: trace.profitLockResult.lockedProfitAmount,
      currentEquity,
    });
    return true;
  }

  async initialize() {
    const deps = this._real;
    const instance = await deps.findInstanceById(this.botInstanceId);
    if (!instance) {
      throw new Error(`Bot instance ${this.botInstanceId} not found`);
    }
    const tradeHistory = await deps.loadTradeHistoryForLearning(this.botInstanceId);
    this.state = instanceToApirsState(instance, tradeHistory);
    this.dailyDrawdownMarkers = markersFromInstance(instance);

    const openTrades = await deps.listOpenSyntheticTradesForResume(this.botInstanceId);
    if (openTrades.length > 0) {
      await this._resumeOpenTrade(openTrades[0], tradeHistory);
    }
  }

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

  async _resumeRealOpenTrade(row, tradeHistory) {
    const deps = this._real;
    const brokerTicket = row.broker_ticket == null ? null : Number(row.broker_ticket);
    if (brokerTicket == null) {
      await this._haltRealFailure('real_resume_missing_ticket', {
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
      await this._haltRealFailure('real_resume_positions_unavailable', {
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

    const history = await this._fetchOrderHistoryWithRetries(brokerTicket, {
      context: 'real_resume',
      tradeId: row.id,
    });
    if (!history) return;

    this.openPosition = pos;
    await this._applyRealCloseFromHistory(pos, history);
  }

  async _fetchOrderHistoryWithRetries(brokerTicket, { context, tradeId }) {
    const deps = this._real;
    const maxRetries = deps.historyRetryTicks;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        return await deps.getOrderHistory(brokerTicket);
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries) {
          console.warn(
            `[synthetic-bot-runtime] ${context} history lag for ticket ${brokerTicket} ` +
              `(${attempt}/${maxRetries}): ${err.message}`
          );
        }
      }
    }
    await this._haltRealFailure('order_history_unavailable', {
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
    if (this._halted) return;
    if (this.running) return;
    this.running = true;
    if (!this.autoTick) return;
    this.timer = setInterval(() => {
      this.tickOnce().catch((err) => {
        console.error('[synthetic-bot-runtime] tick failed:', err.message);
      });
    }, this.tickMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  async stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tickOnce() {
    if (this._halted) return null;
    if (this._tickInFlight) return null;
    this._tickInFlight = true;
    try {
      const resolvedMode = await this._resolveExecutionModeForTick();
      // Each tick: reconcile orphaned DB real opens / anomalous broker positions
      // (E.6-style + defensive orphan scan). Cheap when no open real rows.
      await this._reconcileSyntheticRealAgainstBroker();

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

  async _resolveExecutionModeForTick() {
    const instance = await this._real.findInstanceById(this.botInstanceId);
    if (!instance) {
      if (NODE_ENV !== 'production') {
        console.info('[synthetic-bot-runtime] tick', {
          resolvedMode: 'paper',
          reason: 'no_instance',
          bot_instance_id: this.botInstanceId,
        });
      }
      return 'paper';
    }

    const confirmationActive = isConfirmationActive(
      instance.synthetic_live_trading_confirmed_at
    );
    const allowDemoRealExecution = SYNTHETIC_REAL_TRADING_ALLOW_DEMO === true;
    const resolvedMode = resolveExecutionMode({
      realTradingEnabled: SYNTHETIC_REAL_TRADING_ENABLED,
      accountType: instance.account_type,
      liveTradingConfirmedAt: instance.synthetic_live_trading_confirmed_at,
      allowDemoRealExecution,
    });

    const usedDemoBypass =
      resolvedMode === 'real' &&
      instance.account_type === 'demo' &&
      allowDemoRealExecution;
    if (usedDemoBypass) {
      console.warn(
        '[synthetic-bot-runtime] real dispatch ENABLED VIA SYNTHETIC_REAL_TRADING_ALLOW_DEMO ' +
          `(testing-only demo bypass) bot_instance_id=${this.botInstanceId} ` +
          `user_id=${this.userId} account_type=demo`
      );
    }

    if (NODE_ENV !== 'production') {
      console.info('[synthetic-bot-runtime] tick', {
        resolvedMode,
        account_type: instance.account_type,
        synthetic_real_trading_enabled: SYNTHETIC_REAL_TRADING_ENABLED === true,
        synthetic_real_trading_allow_demo: allowDemoRealExecution,
        confirmation_active: confirmationActive,
        open_position: Boolean(this.openPosition),
        bot_instance_id: this.botInstanceId,
      });
    }

    return resolvedMode;
  }

  /**
   * Tick-time one-open guard — system-wide across all asset_class values
   * for this user (docs/11 §0.2 / DB `one_open_trade_per_user`). Same pattern
   * as crypto-bot-runtime. Layer 1/2 stay independently scoped per asset class.
   */
  async _hasAnyOpenTradeForUser() {
    const open = await this._real.listOpenTradesForUser(this.userId);
    return open.length > 0;
  }

  async _maybeOpenPositionPaper() {
    if (await this._hasAnyOpenTradeForUser()) {
      return null;
    }

    const dd = await this._refreshDailyDrawdown(this.state.balance);
    const selection = await this.strategySelection.selectSyntheticTradeAcrossWatchlist();
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

    const tierRows = await this._real.getTierRows();
    const entryResult = evaluateEntry(this.state, tradeInput, { tierRows });
    await logEntryDecision(
      this.botInstanceId,
      tradeInput,
      entryResult,
      selection,
      this._real.insertDecision
    );

    if (!entryResult.tradeApproved) {
      return { state: this.state, entryResult, trade: null };
    }

    const symbol = selection.chosen_instrument;
    let symbolInfo;
    try {
      symbolInfo = await this._real.getSymbolInfo(symbol);
    } catch (err) {
      console.error('[synthetic-bot-runtime] price fetch failed, will retry next tick:', err.message);
      return null;
    }
    if (
      symbolInfo.bid == null ||
      symbolInfo.ask == null ||
      !(Number(symbolInfo.bid) > 0) ||
      !(Number(symbolInfo.ask) > 0)
    ) {
      console.error('[synthetic-bot-runtime] MT5 returned no usable live tick for', symbol);
      return null;
    }

    const spec = normalizeSyntheticContractSpec({ ...symbolInfo, symbol });
    if (!spec.sizingReady) {
      await this._real.insertDecision({
        botInstanceId: this.botInstanceId,
        decisionType: 'trade_rejected',
        triggeringCondition: 'synthetic_contract_spec_not_sizing_ready',
        details: { symbol, reason: spec.reason || null, spec },
        assetClass: ASSET_CLASS,
      });
      return { state: this.state, entryResult, trade: null, specRejected: true };
    }

    const direction = selection.direction;
    const entryPrice = direction === 'BUY' ? symbolInfo.ask : symbolInfo.bid;
    const { stopPrice, targetPrice } = this.strategySelection.computeSelectionStopTarget(
      selection,
      entryPrice
    );
    const lotSize = Number((entryResult.riskResult.appliedRisk * 0.1).toFixed(4)) || 0.01;

    const conditions = {
      ...tradeInput,
      strategy_id: selection.strategy_id,
      strategy_name: selection.strategy_name,
      trade_contract_size: spec.trade_contract_size,
      asset_class: ASSET_CLASS,
    };

    let tradeRow;
    try {
      tradeRow = await tradesRepository.insertOpenPaperTrade({
        botInstanceId: this.botInstanceId,
        symbol,
        direction,
        entryPrice,
        stopPrice,
        targetPrice,
        lotSize,
        finalAppliedPositionRisk: entryResult.riskResult.appliedRisk,
        conditions,
        assetClass: ASSET_CLASS,
      });
    } catch (err) {
      if (err && err.code === '23505') {
        // 23505 — system-wide one_open_trade_per_user race.
        console.warn('[synthetic-bot-runtime] open blocked by one_open_trade_per_user');
        return null;
      }
      throw err;
    }

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

    await this._real.publishBotEvent(this.botInstanceId, 'trade.opened', tradeRow);
    return { state: this.state, entryResult, trade: tradeRow };
  }

  async _maybeOpenPositionReal() {
    const deps = this._real;

    if (await this._hasAnyOpenTradeForUser()) {
      return null;
    }

    // Read-only Layer 0 / equity pre-check. One short retry absorbs a
    // transient MT5 IPC blip (-10004). Deliberately NOT shared with
    // placeOrder — Batch 2 keeps "log, skip, no auto-retry" for real orders
    // to avoid double-fills.
    let accountInfo;
    try {
      accountInfo = await deps.getMatchedAccountInfo(this.botInstanceId);
    } catch (firstErr) {
      console.warn(
        '[synthetic-bot-runtime] account-info pre-check failed; one read-only retry ' +
          `after ${ACCOUNT_INFO_PRECHECK_RETRY_DELAY_MS}ms (not placeOrder)`,
        { message: firstErr.message, code: firstErr.code || null }
      );
      try {
        await new Promise((r) => setTimeout(r, ACCOUNT_INFO_PRECHECK_RETRY_DELAY_MS));
        accountInfo = await deps.getMatchedAccountInfo(this.botInstanceId);
      } catch (err) {
        await this._haltRealFailure('account_info_unavailable', {
          message: err.message,
          code: err.code || null,
          retried: true,
          first_error: firstErr.message,
        });
        return { state: this.state, entryResult: null, trade: null, error: true };
      }
    }

    if (!isConnectionFresh(accountInfo.last_validated_at, deps.maxAgeHours, deps.now())) {
      await this._haltRealFailure('stale_broker_connection', {
        last_validated_at: accountInfo.last_validated_at,
        max_age_hours: deps.maxAgeHours,
      });
      return { state: this.state, entryResult: null, trade: null, error: true };
    }

    const equity = Number(accountInfo.equity);
    if (!(equity > 0)) {
      await this._haltRealFailure('invalid_live_equity', {
        equity: accountInfo.equity,
      });
      return { state: this.state, entryResult: null, trade: null, error: true };
    }

    this.state.balance = equity;
    this.state.peakEquity = Math.max(Number(this.state.peakEquity) || 0, equity);
    const dd = await this._refreshDailyDrawdown(equity, { persist: false });
    const synced = await deps.updateStatusFields(this.botInstanceId, {
      synthetic_active_trading_balance: this.state.balance,
      synthetic_peak_equity: this.state.peakEquity,
      ...dailyFieldsFromMarkers(dd.markers),
    });
    await deps.setStatus(synced);
    await deps.publishBotEvent(this.botInstanceId, 'equity.updated', {
      synthetic_active_trading_balance: this.state.balance,
      synthetic_peak_equity: this.state.peakEquity,
      timestamp: new Date().toISOString(),
    });

    // Layer 0 — true detected type from the live connector read.
    // Must NEVER be derived from resolveExecutionMode()'s 'real' dispatch.
    const expectedAccountType = resolveExpectedAccountTypeForLayer0(accountInfo.account_type);

    const selection = await this.strategySelection.selectSyntheticTradeAcrossWatchlist();
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
      console.error(
        '[synthetic-bot-runtime] real open price fetch failed, will retry next tick:',
        err.message
      );
      return null;
    }
    if (
      symbolInfo.bid == null ||
      symbolInfo.ask == null ||
      !(Number(symbolInfo.bid) > 0) ||
      !(Number(symbolInfo.ask) > 0)
    ) {
      console.error(
        '[synthetic-bot-runtime] MT5 returned no usable live tick for',
        symbol,
        '- will retry next tick'
      );
      return null;
    }

    const spec = normalizeSyntheticContractSpec({ ...symbolInfo, symbol });
    if (!spec.sizingReady) {
      console.warn(
        '[synthetic-bot-runtime] real open skipped: synthetic_contract_spec_not_sizing_ready',
        { symbol, reason: spec.reason || null }
      );
      return { state: this.state, entryResult, trade: null, specRejected: true };
    }

    const direction = selection.direction;
    const quoteEntry = direction === 'BUY' ? symbolInfo.ask : symbolInfo.bid;
    const { stopPrice, targetPrice } = this.strategySelection.computeSelectionStopTarget(
      selection,
      quoteEntry
    );

    const calculatedSize =
      Number((entryResult.riskResult.appliedRisk * 0.1).toFixed(4)) || 0.01;
    const clamped = deps.clampLotSize(calculatedSize, symbolInfo);
    if (clamped.skipped) {
      console.warn(
        `[synthetic-bot-runtime] real open skipped: lot clamp ${clamped.reason}`,
        { symbol, calculatedSize, volume_min: symbolInfo.volume_min }
      );
      await deps.insertDecision({
        botInstanceId: this.botInstanceId,
        decisionType: 'trade_rejected',
        triggeringCondition: `lot_clamp_${clamped.reason}`,
        details: { symbol, calculatedSize, clamped, symbolInfo },
        assetClass: ASSET_CLASS,
      });
      return { state: this.state, entryResult, trade: null, lotSkipped: true };
    }

    const conditions = {
      ...tradeInput,
      strategy_id: selection.strategy_id,
      strategy_name: selection.strategy_name,
      trade_contract_size: spec.trade_contract_size,
      asset_class: ASSET_CLASS,
    };

    const placeStarted = Date.now();
    let placeResult;
    try {
      placeResult = await deps.placeOrder({
        symbol,
        direction,
        volume: clamped.size,
        sl: stopPrice,
        tp: targetPrice,
        expectedAccountType,
      });
    } catch (err) {
      // Step 4 — rejected real order: log + skip this tick. No paper fallback. No halt.
      const latencyMs = Date.now() - placeStarted;
      console.error(
        '[synthetic-bot-runtime] placeOrder rejected — skipping tick (no paper fallback)',
        {
          message: err.message,
          code: err.code || null,
          details: err.details || null,
          symbol,
          direction,
          volume: clamped.size,
          expected_account_type: expectedAccountType,
          detected_account_type: accountInfo.account_type,
          latency_ms: latencyMs,
        }
      );
      await deps.insertDecision({
        botInstanceId: this.botInstanceId,
        decisionType: 'real_order_failed',
        triggeringCondition: 'place_order_rejected_skip_tick',
        details: {
          message: err.message,
          code: err.code || null,
          details: err.details || null,
          symbol,
          direction,
          volume: clamped.size,
          expected_account_type: expectedAccountType,
          detected_account_type: accountInfo.account_type,
          latency_ms: latencyMs,
        },
        assetClass: ASSET_CLASS,
      });
      return { state: this.state, entryResult, trade: null, placeRejected: true };
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
        : clamped.size;

    let tradeRow;
    try {
      tradeRow = await deps.insertOpenRealTrade({
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
        assetClass: ASSET_CLASS,
      });
    } catch (err) {
      if (err && err.code === '23505') {
        // 23505 — system-wide one_open_trade_per_user race.
        console.warn(
          '[synthetic-bot-runtime] real open blocked by one_open_trade_per_user'
        );
        return null;
      }
      throw err;
    }

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
        calculated_size: calculatedSize,
        clamped,
        entry_price: entryPrice,
        stop_price: stopPrice,
        target_price: targetPrice,
        expected_account_type: expectedAccountType,
        detected_account_type: accountInfo.account_type,
        latency_ms: latencyMs,
        latency_flagged: latencyMs > REAL_ORDER_LATENCY_WARN_MS,
      },
      assetClass: ASSET_CLASS,
    });

    if (latencyMs > REAL_ORDER_LATENCY_WARN_MS) {
      console.warn(
        `[synthetic-bot-runtime] real placeOrder latency ${latencyMs}ms exceeds ${REAL_ORDER_LATENCY_WARN_MS}ms`,
        { botInstanceId: this.botInstanceId, brokerTicket }
      );
    }

    await deps.forceNotifyUser(
      this.userId,
      'real_order',
      `Synthetics real order placed: ${direction} ${symbol} ticket ${brokerTicket} (${lotSize} lots).`
    );

    await deps.publishBotEvent(this.botInstanceId, 'trade.opened', tradeRow);
    return { state: this.state, entryResult, trade: tradeRow };
  }

  async _monitorOpenPositionPaper() {
    const pos = this.openPosition;

    let symbolInfo;
    try {
      symbolInfo = await this._real.getSymbolInfo(pos.symbol);
    } catch (err) {
      console.error('[synthetic-bot-runtime] price fetch failed, will retry next tick:', err.message);
      return null;
    }
    if (
      symbolInfo.bid == null ||
      symbolInfo.ask == null ||
      !(Number(symbolInfo.bid) > 0) ||
      !(Number(symbolInfo.ask) > 0)
    ) {
      return null;
    }

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
      return null;
    }

    const exitPrice = current;
    const stopDistance = Math.abs(pos.entryPrice - pos.stopPrice);
    const signedMove = (exitPrice - pos.entryPrice) * (pos.direction === 'BUY' ? 1 : -1);
    const realRMultiple = stopDistance > 0 ? signedMove / stopDistance : 0;
    const pnlAmount = pos.entryResult.riskedAmount * realRMultiple;
    const wasWin = pnlAmount > 0;

    const tierRows = await this._real.getTierRows();
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
    const ddClose = await this._refreshDailyDrawdown(nextState.balance, { persist: false });

    const closedTrade = await tradesRepository.closePaperTrade(pos.tradeRowId, {
      exitPrice,
      pnl: pnlAmount,
    });

    await logExitDecisions(this.botInstanceId, this.userId, previousMode, trace, this._real);

    if (closedTrade) {
      await this._real.publishBotEvent(this.botInstanceId, 'trade.closed', closedTrade);
    }

    const updated = await this._real.updateStatusFields(this.botInstanceId, {
      synthetic_status: 'running',
      active_strategy_mode: nextState.activeStrategyMode,
      synthetic_active_trading_balance: nextState.balance,
      synthetic_peak_equity: nextState.peakEquity,
      synthetic_current_tier: nextState.currentTier,
      ...dailyFieldsFromMarkers(ddClose.markers),
    });
    const cached = await this._real.setStatus(updated);

    await this._real.publishBotEvent(this.botInstanceId, 'equity.updated', {
      synthetic_active_trading_balance: nextState.balance,
      synthetic_peak_equity: nextState.peakEquity,
      timestamp: cached.updated_at,
    });

    this.openPosition = null;
    return { state: nextState, trace, trade: closedTrade, session: cached };
  }

  /**
   * E.6 mirror — broker holds SL/TP; tick only detects close via positions
   * + reconciles via /order/history. No local stop/target compare.
   */
  async _monitorOpenPositionReal() {
    const deps = this._real;
    const pos = this.openPosition;
    if (!pos || pos.executionMode !== 'real' || pos.brokerTicket == null) {
      await this._haltRealFailure('real_monitor_missing_position', {
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
      console.error(
        '[synthetic-bot-runtime] real monitor getPositions failed, will retry next tick:',
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

    let history;
    try {
      history = await deps.getOrderHistory(pos.brokerTicket);
    } catch (err) {
      const retries = (pos.historyRetryCount || 0) + 1;
      pos.historyRetryCount = retries;
      const maxRetries = deps.historyRetryTicks;
      if (retries < maxRetries) {
        console.warn(
          `[synthetic-bot-runtime] real monitor history lag for ticket ${pos.brokerTicket} ` +
            `(${retries}/${maxRetries}): ${err.message}`
        );
        return null;
      }
      await this._haltRealFailure('order_history_unavailable', {
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

  async _applyRealCloseFromHistory(pos, history) {
    const deps = this._real;
    const exitPrice = Number(history.close_price);
    const pnlAmount = Number(history.profit);
    if (!(exitPrice > 0) || !Number.isFinite(pnlAmount)) {
      await this._haltRealFailure('order_history_incomplete', {
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

    await logExitDecisions(this.botInstanceId, this.userId, previousMode, trace, deps);

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
      assetClass: ASSET_CLASS,
    });

    await deps.forceNotifyUser(
      this.userId,
      'real_order',
      `Synthetics real order closed: ${pos.direction} ${pos.symbol} ticket ${pos.brokerTicket} pnl ${pnlAmount}.`
    );

    if (closedTrade) {
      await deps.publishBotEvent(this.botInstanceId, 'trade.closed', closedTrade);
    }

    try {
      const accountInfo = await deps.getMatchedAccountInfo(this.botInstanceId);
      const equity = Number(accountInfo.equity);
      if (equity > 0) {
        this.state.balance = equity;
        this.state.peakEquity = Math.max(Number(this.state.peakEquity) || 0, equity);
      }
    } catch (err) {
      console.error(
        '[synthetic-bot-runtime] post-close equity sync failed, keeping APIRS state:',
        err.message
      );
    }

    const ddClose = await this._refreshDailyDrawdown(this.state.balance, { persist: false });
    const statusFields = {
      active_strategy_mode: nextState.activeStrategyMode,
      synthetic_active_trading_balance: this.state.balance,
      synthetic_peak_equity: this.state.peakEquity,
      synthetic_current_tier: nextState.currentTier,
      ...dailyFieldsFromMarkers(ddClose.markers),
    };
    if (this.running) {
      statusFields.synthetic_status = 'running';
    }

    const updated = await deps.updateStatusFields(this.botInstanceId, statusFields);
    const cached = await deps.setStatus(updated);

    await deps.publishBotEvent(this.botInstanceId, 'equity.updated', {
      synthetic_active_trading_balance: this.state.balance,
      synthetic_peak_equity: this.state.peakEquity,
      timestamp: cached.updated_at,
    });

    this.openPosition = null;
    return { state: this.state, trace, trade: closedTrade, session: cached };
  }

  /**
   * Step 5 reconciliation each tick:
   * 1) DB open synthetic+real without matching broker ticket → history close
   * 2) Broker Volatility Index position with no matching DB row → anomaly log
   * Justification for every tick: same cadence as forex E.6 monitor; open
   * real rows are rare (≤1), so the extra /positions call is acceptable.
   */
  async _reconcileSyntheticRealAgainstBroker() {
    const deps = this._real;
    let dbOpen;
    try {
      dbOpen = await deps.listOpenSyntheticRealTrades(this.botInstanceId);
    } catch (err) {
      console.error('[synthetic-bot-runtime] reconcile listOpenSyntheticRealTrades failed:', err.message);
      return;
    }

    let allPositions;
    try {
      allPositions = await deps.getPositions();
    } catch (err) {
      console.error(
        '[synthetic-bot-runtime] reconcile getPositions failed, will retry next tick:',
        err.message
      );
      return;
    }
    const positions = allPositions || [];
    const ticketsOpen = new Set(positions.map((p) => Number(p.ticket)));

    for (const row of dbOpen) {
      const ticket = row.broker_ticket == null ? null : Number(row.broker_ticket);
      if (ticket == null) {
        console.error(
          '[synthetic-bot-runtime] ANOMALY: open real synthetic trade missing broker_ticket',
          { trade_id: row.id, symbol: row.symbol }
        );
        continue;
      }
      if (ticketsOpen.has(ticket)) {
        continue;
      }
      // Already tracked in-memory — monitor path will handle.
      if (
        this.openPosition &&
        this.openPosition.executionMode === 'real' &&
        Number(this.openPosition.brokerTicket) === ticket
      ) {
        continue;
      }

      console.warn(
        `[synthetic-bot-runtime] reconcile: DB open ticket ${ticket} gone from broker — closing from history`
      );
      const history = await this._fetchOrderHistoryWithRetries(ticket, {
        context: 'reconcile',
        tradeId: row.id,
      });
      if (!history) continue;

      const tradeHistory = await deps.loadTradeHistoryForLearning(this.botInstanceId);
      const pos = this._buildResumedOpenPosition(row, tradeHistory, {
        executionMode: 'real',
        brokerTicket: ticket,
        historyRetryCount: 0,
      });
      this.openPosition = pos;
      await this._applyRealCloseFromHistory(pos, history);
    }

    const knownTickets = new Set(
      dbOpen
        .map((r) => (r.broker_ticket == null ? null : Number(r.broker_ticket)))
        .filter((t) => t != null)
    );
    if (
      this.openPosition &&
      this.openPosition.executionMode === 'real' &&
      this.openPosition.brokerTicket != null
    ) {
      knownTickets.add(Number(this.openPosition.brokerTicket));
    }

    for (const p of positions) {
      const sym = String(p.symbol || '');
      if (!SYNTHETIC_WATCHLIST_SET.has(sym)) continue;
      const ticket = Number(p.ticket);
      if (!knownTickets.has(ticket)) {
        console.error(
          '[synthetic-bot-runtime] ANOMALY: broker synthetic position with no matching DB open row',
          { ticket, symbol: sym, volume: p.volume ?? null }
        );
      }
    }
  }

  async _haltRealFailure(reason, details) {
    this._halted = true;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    try {
      await this._real.insertDecision({
        botInstanceId: this.botInstanceId,
        decisionType: 'real_order_failed',
        triggeringCondition: reason,
        details: details || {},
        assetClass: ASSET_CLASS,
      });
    } catch (err) {
      console.error('[synthetic-bot-runtime] real_order_failed log failed:', err.message);
    }

    try {
      await this._real.forceNotifyUser(
        this.userId,
        'real_order',
        `Synthetics real order failed (${reason}). Bot stopped in error — investigate before Start.`
      );
    } catch (err) {
      console.error('[synthetic-bot-runtime] real_order_failed notify failed:', err.message);
    }

    try {
      const updated = await this._real.updateStatusFields(this.botInstanceId, {
        synthetic_status: 'error',
      });
      await this._real.setStatus(updated);
      await this._real.publishBotEvent(this.botInstanceId, 'bot.status_changed', {
        status: updated.status,
        synthetic_status: 'error',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[synthetic-bot-runtime] failed to persist error status:', err.message);
    }

    syntheticRuntimes.delete(this.botInstanceId);
  }
}

/** @type {Map<string, SyntheticBotRuntime>} */
const syntheticRuntimes = new Map();

async function startSyntheticRuntime(instance, options = {}) {
  const existing = syntheticRuntimes.get(instance.id);
  if (existing) {
    if (!existing.running && !existing._halted) {
      await existing.initialize();
      existing.start();
    }
    return existing;
  }
  const runtime = new SyntheticBotRuntime(instance, options);
  await runtime.initialize();
  syntheticRuntimes.set(instance.id, runtime);
  runtime.start();
  return runtime;
}

async function stopSyntheticRuntime(botInstanceId) {
  const runtime = syntheticRuntimes.get(botInstanceId);
  if (!runtime) return;
  await runtime.stop();
  syntheticRuntimes.delete(botInstanceId);
}

function getSyntheticRuntime(botInstanceId) {
  return syntheticRuntimes.get(botInstanceId) || null;
}

module.exports = {
  SyntheticBotRuntime,
  startSyntheticRuntime,
  stopSyntheticRuntime,
  getSyntheticRuntime,
  DEFAULT_TICK_MS,
  ASSET_CLASS,
};
