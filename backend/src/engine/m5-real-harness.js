'use strict';

const path = require('path');
const mt5Connector = require('../services/mt5-connector.client');
const candidateStrategiesRepository = require('./candidate-strategies.repository');
const tradesRepository = require('./trades.repository');
const decisionLogRepository = require('./decision-log.repository');
const botInstanceRepository = require('./bot-instance.repository');
const notificationsService = require('../services/notifications.service');
const { getMatchedAccountInfoForBotInstance } = require('./broker-account.service');
const { resolveExecutionMode } = require('./execution-mode');
const m5DemoDispatchServiceDefault = require('./m5-demo-dispatch.service');
const { M5_REAL_TRADING_ENABLED, REAL_CONNECTION_MAX_AGE_HOURS } = require('../config/env');
const { attemptOpen, attemptMonitor, ASSET_CLASS } = require('./m5-real-dispatch');

const newsIntelligencePath = path.join(__dirname, '..', '..', '..', 'bot', 'news-intelligence', 'src');
const { WATCHLIST } = require(path.join(newsIntelligencePath, 'watchlist.js'));

const DEFAULT_TICK_MS = Number(process.env.M5_REAL_TICK_MS) || 15000;
const MAX_HISTORY = 200;

/**
 * M5 PAPER-ONLY EXPERIMENT real-dispatch harness (docs/14_M5_Forex_Paper_Experiment.md).
 *
 * UNPROVEN LIVE. This is a SEPARATE module/singleton from m5-paper-harness.js
 * — that file is untouched by this build and remains structurally incapable
 * of placing a real order (see its header). This harness is the opposite:
 * it exists specifically to place real orders, but only once an admin has
 * explicitly armed all four safety layers (below) and pressed Start on
 * *this* tool — never reachable from the Trading page, never automatic.
 *
 * Global singleton, one real M5 session at a time, admin-operated on
 * behalf of one admin user (`operatorUserId`) — that admin must already
 * have a linked broker connection (same `ensureForUser` reuse as forex/
 * crypto/synthetics); M5 real trades land in the SAME `bot_instances` row
 * and `trades` table as that admin's other asset classes, tagged
 * asset_class='m5_forex_gold' (migration 025), which is what makes the
 * system-wide one_open_trade_per_user check (docs/11 §0.2) apply
 * bidirectionally: an open M5 real trade blocks that admin's forex/
 * crypto/synthetic opens too, and vice versa (enforced both at the DB
 * unique index and in m5-real-dispatch.js's attemptOpen).
 *
 * Layer 0-3 are re-verified every tick (mirrors bot-runtime.js's
 * `_resolveTickContext` — never cached at Start time only). If the gate
 * degrades mid-session (confirmation TTL lapses, an admin disables the
 * demo-dispatch toggle, REAL_TRADING_ENABLED flips off), this halts to
 * status='error' rather than silently falling back to anything — there
 * is no paper fallback in this module by design; paper stays entirely in
 * m5-paper-harness.js.
 *
 * Known limitation, deliberately not built in this pass: no resume-after-
 * backend-restart for an open real position (bot-runtime.js has this for
 * forex via `_resumeRealOpenTrade`). If the backend restarts while this
 * harness has an open real trade, the broker-side SL/TP still protects
 * the position, but this harness will no longer track/monitor/close it
 * automatically — a human must check MT5 directly. Flagged, not silently
 * half-built.
 */
function createM5RealHarness(deps = {}) {
  const connector = deps.mt5Connector || mt5Connector;
  const strategiesRepo = deps.candidateStrategiesRepository || candidateStrategiesRepository;
  const watchlist = deps.watchlist || WATCHLIST;
  const tickMs = deps.tickMs || DEFAULT_TICK_MS;
  const m5DemoDispatchService = deps.m5DemoDispatchService || m5DemoDispatchServiceDefault;
  const realTradingEnabled = deps.realTradingEnabled ?? M5_REAL_TRADING_ENABLED;

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
    listActiveStrategies:
      deps.listActiveStrategies || (() => strategiesRepo.listActiveStrategies()),
    insertOpenRealTrade:
      deps.insertOpenRealTrade || ((a) => tradesRepository.insertOpenRealTrade(a)),
    closeRealTrade: deps.closeRealTrade || ((id, a) => tradesRepository.closeRealTrade(id, a)),
    insertDecision: deps.insertDecision || ((a) => decisionLogRepository.insertDecision(a)),
    forceNotifyUser:
      deps.forceNotifyUser || ((u, t, m) => notificationsService.forceNotifyUser(u, t, m)),
    now: deps.now || (() => new Date()),
    maxAgeHours: deps.maxAgeHours ?? REAL_CONNECTION_MAX_AGE_HOURS,
    watchlist,
    botInstanceId: null,
    userId: null,
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

  function pushDecision(entry) {
    decisionLog.unshift({ ...entry, at: new Date().toISOString() });
    if (decisionLog.length > MAX_HISTORY) decisionLog.length = MAX_HISTORY;
  }

  function pushClosedTrade(trade) {
    closedTrades.unshift(trade);
    if (closedTrades.length > MAX_HISTORY) closedTrades.length = MAX_HISTORY;
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
      console.error('[m5-real-harness] real_order_failed log failed:', err.message);
    }
    try {
      await repo.forceNotifyUser(
        repo.userId,
        'real_order',
        `M5 real-dispatch experiment halted (${reason}). Investigate before restarting.`
      );
    } catch (err) {
      console.error('[m5-real-harness] halt notify failed:', err.message);
    }
  }

  /**
   * Re-verified every tick, never cached at start-time only (mirrors
   * bot-runtime.js's `_resolveTickContext`). Layer 1 (env) is read once
   * at harness construction like forex's REAL_TRADING_ENABLED; Layers 2/3
   * are read fresh every call.
   */
  async function resolveArmedState() {
    const instance = await findInstanceById(repo.botInstanceId);
    if (!instance) {
      return { armed: false, reason: 'bot_instance_not_found', instance: null };
    }
    const allowDemoRealExecution = await m5DemoDispatchService.isM5DemoDispatchEnabled();
    const mode = resolveExecutionMode({
      realTradingEnabled,
      accountType: instance.account_type,
      liveTradingConfirmedAt: instance.m5_live_trading_confirmed_at,
      allowDemoRealExecution,
    });
    return { armed: mode === 'real', reason: mode === 'real' ? null : 'not_armed', instance };
  }

  async function tick() {
    tickCount += 1;
    try {
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
          });
          openTrade = null;
        }
        lastTickError = null;
        return;
      }

      const { armed, reason } = await resolveArmedState();
      if (!armed) {
        await haltSession('gate_no_longer_armed', { reason });
        return;
      }

      const result = await attemptOpen(repo);
      if (result.halt) {
        await haltSession(result.outcome, result.details);
        return;
      }
      if (result.outcome === 'opened') {
        openTrade = result.openTrade;
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
        result.outcome === 'one_open_trade_blocked'
      ) {
        pushDecision({ type: result.outcome, ...(result.details || {}) });
      }
      // 'no_signal' / 'no_price' / 'no_data' — deliberately not logged every
      // tick, same reasoning as m5-paper-harness.js (avoid flooding history).
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
      const err = new Error('M5 real session is in error state; Stop before starting again');
      err.code = 'M5_REAL_SESSION_ERROR';
      throw err;
    }
    if (!operatorUserId) {
      const err = new Error('operatorUserId is required to start the M5 real-dispatch session');
      err.code = 'OPERATOR_REQUIRED';
      throw err;
    }
    if (!realTradingEnabled) {
      const err = new Error('M5_REAL_TRADING_ENABLED is not set to true');
      err.code = 'M5_REAL_TRADING_DISABLED';
      throw err;
    }

    const instance = await findBotInstanceForUser(operatorUserId);
    repo.botInstanceId = instance.id;
    repo.userId = operatorUserId;

    const { armed, reason } = await resolveArmedState();
    if (!armed) {
      repo.botInstanceId = null;
      repo.userId = null;
      const err = new Error(`M5 real-dispatch is not armed (${reason})`);
      err.code = 'M5_REAL_DISPATCH_NOT_ARMED';
      throw err;
    }

    status = 'running';
    haltReason = null;
    startedAt = new Date().toISOString();
    stoppedAt = null;
    tickSafe().catch(() => {});
    timer = setInterval(() => {
      tickSafe().catch(() => {});
    }, tickMs);
    // Mirrors bot-runtime.js — an unref'd timer never keeps the Node
    // process alive by itself (matters for tests and clean shutdowns).
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    return getStatus();
  }

  async function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    const hadInstance = repo.botInstanceId;
    status = 'stopped';
    stoppedAt = new Date().toISOString();
    haltReason = null;
    // Clearing confirm-live on Stop mirrors trading-engine.js's forex
    // "re-confirm after every Stop" decision (live-trading-confirmation.js).
    if (hadInstance) {
      try {
        await updateStatusFields(hadInstance, { m5_live_trading_confirmed_at: null });
      } catch (err) {
        console.error(
          '[m5-real-harness] failed to clear m5_live_trading_confirmed_at on stop:',
          err.message
        );
      }
    }
    return getStatus();
  }

  function getStatus() {
    return {
      status,
      startedAt,
      stoppedAt,
      tickMs,
      tickCount,
      watchlist,
      operatorUserId: repo.userId,
      botInstanceId: repo.botInstanceId,
      openTrade,
      closedTrades: closedTrades.slice(0, 20),
      decisionLog: decisionLog.slice(0, 50),
      lastTickError,
      haltReason,
      realTradingEnabled,
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
  }

  return { start, stop, tick: tickSafe, getStatus, _resetForTests };
}

// Global singleton — one real M5 test session at a time, admin-operated
// (mirrors m5-paper-harness.js's singleton pattern; entirely separate
// instance/module, see file header).
const singleton = createM5RealHarness();

module.exports = {
  createM5RealHarness,
  start: singleton.start,
  stop: singleton.stop,
  tick: singleton.tick,
  getStatus: singleton.getStatus,
};
