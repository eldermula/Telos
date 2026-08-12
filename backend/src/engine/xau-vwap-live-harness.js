'use strict';

/**
 * XAUUSD VWAP p90 LIVE harness (docs/17_XAU_VWAP_Live_Strategy.md).
 *
 * CONTROLLED REAL-MONEY — admin-only singleton. Places orders only when
 * Layers 0–3 are armed and only via xau-vwap-live-dispatch → mt5-connector.
 * Independent of m5-real-harness / paper harnesses.
 *
 * Known limitation (same as M5 real): no resume-after-backend-restart for
 * an open real position; broker SL/TP still protect.
 */

const mt5Connector = require('../services/mt5-connector.client');
const tradesRepository = require('./trades.repository');
const decisionLogRepository = require('./decision-log.repository');
const botInstanceRepository = require('./bot-instance.repository');
const notificationsService = require('../services/notifications.service');
const { getMatchedAccountInfoForBotInstance } = require('./broker-account.service');
const { resolveExecutionMode } = require('./execution-mode');
const xauVwapDemoDispatchServiceDefault = require('./xau-vwap-demo-dispatch.service');
const { XAU_VWAP_LIVE_TRADING_ENABLED, REAL_CONNECTION_MAX_AGE_HOURS } = require('../config/env');
const { attemptOpen, attemptMonitor, ASSET_CLASS, SYMBOL } = require('./xau-vwap-live-dispatch');
const { buildLiveMarketSnapshot } = require('./xau-vwap-live-strategy');

const DEFAULT_TICK_MS = Number(process.env.XAU_VWAP_LIVE_TICK_MS) || 15000;
const MAX_HISTORY = 200;

function createXauVwapLiveHarness(deps = {}) {
  const connector = deps.mt5Connector || mt5Connector;
  const tickMs = deps.tickMs || DEFAULT_TICK_MS;
  const demoDispatchService = deps.xauVwapDemoDispatchService || xauVwapDemoDispatchServiceDefault;
  const liveTradingEnabled = deps.liveTradingEnabled ?? XAU_VWAP_LIVE_TRADING_ENABLED;

  const repo = {
    getMatchedAccountInfo:
      deps.getMatchedAccountInfoForBotInstance || getMatchedAccountInfoForBotInstance,
    getRates: deps.getRates || ((s, o) => connector.getRates(s, o)),
    getSymbolInfo: deps.getSymbolInfo || ((s) => connector.getSymbolInfo(s)),
    getPositions: deps.getPositions || ((s) => connector.getPositions(s)),
    getOrderHistory: deps.getOrderHistory || ((t) => connector.getOrderHistory(t)),
    placeOrder: deps.placeOrder || ((a) => connector.placeOrder(a)),
    listOpenTradesForUser:
      deps.listOpenTradesForUser || ((u) => tradesRepository.listOpenTradesForUser(u)),
    insertOpenRealTrade:
      deps.insertOpenRealTrade || ((a) => tradesRepository.insertOpenRealTrade(a)),
    closeRealTrade: deps.closeRealTrade || ((id, a) => tradesRepository.closeRealTrade(id, a)),
    insertDecision: deps.insertDecision || ((a) => decisionLogRepository.insertDecision(a)),
    forceNotifyUser:
      deps.forceNotifyUser || ((u, t, m) => notificationsService.forceNotifyUser(u, t, m)),
    now: deps.now || (() => new Date()),
    maxAgeHours: deps.maxAgeHours ?? REAL_CONNECTION_MAX_AGE_HOURS,
    botInstanceId: null,
    userId: null,
    haltNewOpens: false,
  };
  const findInstanceById = deps.findInstanceById || ((id) => botInstanceRepository.findById(id));
  const findBotInstanceForUser =
    deps.findBotInstanceForUser || ((u) => botInstanceRepository.ensureForUser(u));
  const updateStatusFields =
    deps.updateStatusFields || ((id, f) => botInstanceRepository.updateStatusFields(id, f));

  let status = 'stopped'; // 'stopped' | 'running' | 'error'
  let startedAt = null;
  let stoppedAt = null;
  let timer = null;
  let openTrade = null;
  const closedTrades = [];
  const decisionLog = [];
  let tickCount = 0;
  let lastTickError = null;
  let haltReason = null;
  let tickInFlight = false;
  let lastMarketSnapshot = null;
  let lastSignal = null;
  let lastOrder = null;
  let lastExecutionAt = null;
  let brokerStatus = null;
  let emergencyStopActive = false;
  let candlesObserved = 0;
  let signalsDetected = 0;
  let ordersAttempted = 0;
  let ordersRejected = 0;

  function pushDecision(entry) {
    decisionLog.unshift({ ...entry, at: new Date().toISOString() });
    if (decisionLog.length > MAX_HISTORY) decisionLog.length = MAX_HISTORY;
  }

  function pushClosedTrade(trade) {
    closedTrades.unshift(trade);
    if (closedTrades.length > MAX_HISTORY) closedTrades.length = MAX_HISTORY;
  }

  function computeStats() {
    const closed = closedTrades;
    const wins = closed.filter((t) => t.wasWin).length;
    const n = closed.length;
    const winRate = n > 0 ? wins / n : null;
    const rs = closed.map((t) => t.realizedR).filter((r) => Number.isFinite(r));
    const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
    let equityCurve = 0;
    let peak = 0;
    let maxDd = 0;
    for (const t of closed) {
      equityCurve += Number(t.pnl) || 0;
      if (equityCurve > peak) peak = equityCurve;
      const dd = peak - equityCurve;
      if (dd > maxDd) maxDd = dd;
    }
    const strategyPnl = closed.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
    return {
      liveTradeCount: n + (openTrade ? 1 : 0),
      closedTradeCount: n,
      winRate,
      averageR: avgR,
      maxDrawdown: maxDd,
      strategyPnl,
    };
  }

  async function haltSession(reason, details) {
    status = 'error';
    haltReason = reason;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    pushDecision({ type: reason, halt: true, ...(details || {}) });

    try {
      await repo.insertDecision({
        botInstanceId: repo.botInstanceId,
        decisionType: 'real_order_failed',
        triggeringCondition: reason,
        assetClass: ASSET_CLASS,
        details: details || {},
      });
    } catch (err) {
      console.error('[xau-vwap-live-harness] real_order_failed log failed:', err.message);
    }
    try {
      await repo.forceNotifyUser(
        repo.userId,
        'real_order',
        `XAU VWAP LIVE halted (${reason}). Investigate before restarting.`
      );
    } catch (err) {
      console.error('[xau-vwap-live-harness] halt notify failed:', err.message);
    }
  }

  async function resolveArmedState() {
    const instance = await findInstanceById(repo.botInstanceId);
    if (!instance) {
      return { armed: false, reason: 'bot_instance_not_found', instance: null };
    }
    emergencyStopActive = instance.halt_new_opens === true;
    repo.haltNewOpens = emergencyStopActive;
    if (emergencyStopActive) {
      return { armed: false, reason: 'emergency_stop_active', instance };
    }
    const allowDemoRealExecution = await demoDispatchService.isXauVwapDemoDispatchEnabled();
    const mode = resolveExecutionMode({
      realTradingEnabled: liveTradingEnabled,
      accountType: instance.account_type,
      liveTradingConfirmedAt: instance.xau_vwap_live_trading_confirmed_at,
      allowDemoRealExecution,
    });
    brokerStatus = {
      account_type: instance.account_type,
      mode,
      allowDemoRealExecution,
    };
    return { armed: mode === 'real', reason: mode === 'real' ? null : 'not_armed', instance };
  }

  async function refreshSnapshotBestEffort() {
    try {
      const [ratesResult, symbolInfo] = await Promise.all([
        repo.getRates(SYMBOL, { timeframe: 'M5', count: 120 }),
        repo.getSymbolInfo(SYMBOL),
      ]);
      candlesObserved = Math.max(candlesObserved, (ratesResult.bars || []).length);
      const snap = buildLiveMarketSnapshot({ bars: ratesResult.bars, symbolInfo });
      if (snap.ok) lastMarketSnapshot = { ...snap, at: new Date().toISOString() };
    } catch (err) {
      // best-effort for UI only
      lastTickError = lastTickError || err.message;
    }
  }

  async function tick() {
    tickCount += 1;
    try {
      if (status !== 'running') return;

      if (openTrade) {
        const result = await attemptMonitor(repo, openTrade);
        if (result.halt) {
          await haltSession(result.outcome, result.details);
          return;
        }
        if (result.outcome === 'closed') {
          pushClosedTrade(result.closedTrade);
          pushDecision({
            type: 'closed',
            symbol: openTrade.symbol,
            direction: openTrade.direction,
            pnl: result.closedTrade.pnl,
            realizedR: result.closedTrade.realizedR,
          });
          lastExecutionAt = new Date().toISOString();
          openTrade = null;
        }
        lastTickError = null;
        return;
      }

      if (status !== 'running') return;

      const { armed, reason } = await resolveArmedState();
      if (!armed) {
        await haltSession(reason === 'emergency_stop_active' ? 'emergency_stop_active' : 'gate_no_longer_armed', {
          reason,
        });
        return;
      }

      if (status !== 'running') return;

      const result = await attemptOpen(repo);
      if (result.marketSnapshot) {
        lastMarketSnapshot = { ...result.marketSnapshot, at: new Date().toISOString() };
      } else {
        await refreshSnapshotBestEffort();
      }

      if (
        result.outcome === 'opened' ||
        (result.details && result.details.outcome === undefined && result.outcome !== 'no_signal')
      ) {
        // keep
      }
      if (result.outcome !== 'no_signal' && result.outcome !== 'insufficient_bars') {
        if (
          result.outcome === 'opened' ||
          result.outcome === 'sizing_error' ||
          result.outcome === 'skipped_below_volume_min' ||
          result.outcome === 'place_order_failed' ||
          result.outcome === 'invalid_spread' ||
          result.outcome === 'invalid_stop' ||
          result.outcome === 'stale_market_data'
        ) {
          lastSignal = {
            at: new Date().toISOString(),
            outcome: result.outcome,
            details: result.details || null,
          };
          if (result.outcome === 'opened' || result.outcome === 'place_order_failed') {
            signalsDetected += 1;
          }
        }
      } else {
        pushDecision({ type: 'no_signal', ...(result.details || {}) });
      }

      if (result.openTrade) {
        openTrade = result.openTrade;
        lastOrder = {
          at: new Date().toISOString(),
          ...result.openTrade,
          status: result.outcome,
        };
        lastExecutionAt = lastOrder.at;
        ordersAttempted += 1;
      }
      if (result.halt) {
        if (result.outcome === 'place_order_failed') ordersRejected += 1;
        await haltSession(result.outcome, result.details);
        return;
      }
      if (result.outcome === 'opened') {
        pushDecision({
          type: 'opened',
          symbol: openTrade.symbol,
          direction: openTrade.direction,
          lotSize: openTrade.lotSize,
          entryPrice: openTrade.entryPrice,
          brokerTicket: openTrade.brokerTicket,
        });
      } else if (
        result.outcome === 'skipped_below_volume_min' ||
        result.outcome === 'sizing_error' ||
        result.outcome === 'one_open_trade_blocked' ||
        result.outcome === 'invalid_spread' ||
        result.outcome === 'invalid_stop' ||
        result.outcome === 'stale_market_data'
      ) {
        pushDecision({ type: result.outcome, ...(result.details || {}) });
        if (
          result.outcome === 'invalid_spread' ||
          result.outcome === 'invalid_stop' ||
          result.outcome === 'stale_market_data' ||
          result.outcome === 'sizing_error'
        ) {
          ordersRejected += 1;
        }
      }
      lastTickError = null;
    } catch (err) {
      lastTickError = err.message;
      pushDecision({ type: 'tick_error', message: err.message });
    }
  }

  async function tickSafe() {
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      await tick();
    } finally {
      tickInFlight = false;
    }
  }

  async function start({ operatorUserId } = {}) {
    if (status === 'running') return getStatus();
    if (status === 'error') {
      const err = new Error('XAU VWAP live session is in error state; Stop before starting again');
      err.code = 'XAU_VWAP_LIVE_SESSION_ERROR';
      throw err;
    }
    if (!operatorUserId) {
      const err = new Error('operatorUserId is required to start the XAU VWAP live session');
      err.code = 'OPERATOR_REQUIRED';
      throw err;
    }
    if (!liveTradingEnabled) {
      const err = new Error('XAU_VWAP_LIVE_TRADING_ENABLED is not set to true');
      err.code = 'XAU_VWAP_LIVE_TRADING_DISABLED';
      throw err;
    }

    const instance = await findBotInstanceForUser(operatorUserId);
    repo.botInstanceId = instance.id;
    repo.userId = operatorUserId;

    const { armed, reason } = await resolveArmedState();
    if (!armed) {
      repo.botInstanceId = null;
      repo.userId = null;
      const err = new Error(`XAU VWAP live-dispatch is not armed (${reason})`);
      err.code = 'XAU_VWAP_LIVE_DISPATCH_NOT_ARMED';
      throw err;
    }

    status = 'running';
    haltReason = null;
    startedAt = new Date().toISOString();
    stoppedAt = null;
    candlesObserved = 0;
    signalsDetected = 0;
    ordersAttempted = 0;
    ordersRejected = 0;
    console.warn(
      `[xau-vwap-live-harness] LIVE MARKET DATA session START operator=${operatorUserId} ` +
        `symbol=${SYMBOL} timeframe=M5 — CONTROLLED REAL-MONEY`
    );
    tickSafe().catch(() => {});
    timer = setInterval(() => {
      tickSafe().catch(() => {});
    }, tickMs);
    if (typeof timer.unref === 'function') timer.unref();
    return getStatus();
  }

  async function stop() {
    status = 'stopped';
    stoppedAt = new Date().toISOString();
    haltReason = null;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    const waitStart = Date.now();
    while (tickInFlight && Date.now() - waitStart < 30000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (openTrade) {
      console.warn(
        `[xau-vwap-live-harness] Stop while openTrade still set (ticket=${openTrade.brokerTicket}). ` +
          'Broker SL/TP remain; harness will no longer monitor. Reconcile manually if needed.'
      );
      pushDecision({
        type: 'stopped_with_open_trade',
        symbol: openTrade.symbol,
        brokerTicket: openTrade.brokerTicket,
        message: 'Stop abandoned monitoring; broker SL/TP still active',
      });
    }
    const hadInstance = repo.botInstanceId;
    if (hadInstance) {
      try {
        await updateStatusFields(hadInstance, { xau_vwap_live_trading_confirmed_at: null });
      } catch (err) {
        console.error(
          '[xau-vwap-live-harness] failed to clear xau_vwap_live_trading_confirmed_at on stop:',
          err.message
        );
      }
    }
    console.warn('[xau-vwap-live-harness] DISABLED AFTER LIVE SESSION STOP');
    repo.botInstanceId = null;
    repo.userId = null;
    return getStatus();
  }

  function resolveUiStatus() {
    if (emergencyStopActive || haltReason === 'emergency_stop_active') return 'BLOCKED';
    if (status === 'error') return 'BLOCKED';
    if (status === 'running' && liveTradingEnabled) return 'ENABLED';
    return 'DISABLED';
  }

  function getStatus() {
    const stats = computeStats();
    return {
      status,
      uiStatus: resolveUiStatus(),
      realMoney: true,
      strategyId: 'xau-vwap-p90-reversion-live',
      strategyLabel: 'XAUUSD VWAP p90 — LIVE',
      instrument: SYMBOL,
      timeframe: 'M5',
      startedAt,
      stoppedAt,
      tickMs,
      tickCount,
      operatorUserId: repo.userId,
      botInstanceId: repo.botInstanceId,
      openTrade,
      closedTrades: closedTrades.slice(0, 20),
      decisionLog: decisionLog.slice(0, 50),
      lastTickError,
      haltReason,
      liveTradingEnabled,
      emergencyStopActive,
      brokerStatus,
      lastMarketSnapshot,
      lastSignal,
      lastOrder,
      lastExecutionAt,
      candlesObserved,
      signalsDetected,
      ordersAttempted,
      ordersRejected,
      ...stats,
    };
  }

  function _resetForTests() {
    if (timer) clearInterval(timer);
    timer = null;
    status = 'stopped';
    startedAt = null;
    stoppedAt = null;
    repo.botInstanceId = null;
    repo.userId = null;
    openTrade = null;
    closedTrades.length = 0;
    decisionLog.length = 0;
    tickCount = 0;
    lastTickError = null;
    haltReason = null;
    lastMarketSnapshot = null;
    lastSignal = null;
    lastOrder = null;
    lastExecutionAt = null;
    emergencyStopActive = false;
    candlesObserved = 0;
    signalsDetected = 0;
    ordersAttempted = 0;
    ordersRejected = 0;
  }

  return { start, stop, tick: tickSafe, getStatus, _resetForTests };
}

const singleton = createXauVwapLiveHarness();

module.exports = {
  createXauVwapLiveHarness,
  start: singleton.start,
  stop: singleton.stop,
  tick: singleton.tick,
  getStatus: singleton.getStatus,
};
