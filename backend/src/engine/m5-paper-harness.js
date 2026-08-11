'use strict';

const path = require('path');
const mt5Connector = require('../services/mt5-connector.client');
const candidateStrategiesRepository = require('./candidate-strategies.repository');
const { evaluateM5Tick, evaluateM5Monitor } = require('./m5-paper-strategy');

const newsIntelligencePath = path.join(__dirname, '..', '..', '..', 'bot', 'news-intelligence', 'src');
const { WATCHLIST } = require(path.join(newsIntelligencePath, 'watchlist.js'));

const DEFAULT_TICK_MS = Number(process.env.M5_PAPER_TICK_MS) || 15000;
const M5_BAR_COUNT = 100;
const MAX_HISTORY = 200;

/**
 * M5 PAPER-ONLY EXPERIMENT harness (docs/14_M5_Forex_Paper_Experiment.md).
 * Global, admin-started/stopped, in-memory only — no DB writes, no
 * `bot_instances` row, no relation to any user's live forex/synthetics
 * session. Restarting the backend clears its history; that is
 * intentional for an explicitly experimental, not-yet-proven tool, not
 * an oversight.
 *
 * HARD BOUNDARY, enforced structurally: this module's only MT5
 * connector calls are `getRates`, `getSymbolInfo`, and `getAccountInfo`
 * — all read-only GET endpoints. It never imports `placeOrder`/
 * `closeOrder`, `bot-runtime.js`, `trading-engine.js`,
 * `REAL_TRADING_ENABLED`, confirm-live, or any admin real-dispatch
 * service. There is no code path here that calls the connector's
 * `/order/*` endpoints — this cannot place a real order even in
 * principle, not just "won't because a flag says paper."
 */
function createM5PaperHarness(deps = {}) {
  const connector = deps.mt5Connector || mt5Connector;
  const strategiesRepo = deps.candidateStrategiesRepository || candidateStrategiesRepository;
  const watchlist = deps.watchlist || WATCHLIST;
  const tickMs = deps.tickMs || DEFAULT_TICK_MS;

  let status = 'stopped';
  let startedAt = null;
  let stoppedAt = null;
  let timer = null;
  let openTrade = null; // one open paper trade at a time — same one-position-system-wide design as the live engine
  const closedTrades = [];
  const decisionLog = [];
  let tickCount = 0;
  let lastTickError = null;

  function pushDecision(entry) {
    decisionLog.unshift({ ...entry, at: new Date().toISOString() });
    if (decisionLog.length > MAX_HISTORY) decisionLog.length = MAX_HISTORY;
  }

  function pushClosedTrade(trade) {
    closedTrades.unshift(trade);
    if (closedTrades.length > MAX_HISTORY) closedTrades.length = MAX_HISTORY;
  }

  async function monitorOpenTrade() {
    if (!openTrade) return;

    let symbolInfo;
    try {
      symbolInfo = await connector.getSymbolInfo(openTrade.symbol);
    } catch (err) {
      pushDecision({ type: 'monitor_error', symbol: openTrade.symbol, message: err.message });
      return;
    }

    const result = evaluateM5Monitor(openTrade, symbolInfo);
    if (!result) return;

    const closed = {
      ...openTrade,
      status: 'closed',
      closePrice: result.closePrice,
      pnl: result.pnl,
      outcome: result.outcome,
      closedAt: new Date().toISOString(),
    };
    pushClosedTrade(closed);
    pushDecision({
      type: result.outcome,
      symbol: openTrade.symbol,
      direction: openTrade.direction,
      pnl: result.pnl,
    });
    openTrade = null;
  }

  async function tryOpen() {
    if (openTrade) return; // one-position-system-wide, mirrors the live engine

    let accountInfo;
    try {
      accountInfo = await connector.getAccountInfo();
    } catch (err) {
      pushDecision({ type: 'account_info_unavailable', message: err.message });
      return;
    }

    const balance = Number(accountInfo.equity ?? accountInfo.balance);
    if (!(balance > 0)) {
      pushDecision({ type: 'account_info_unavailable', message: 'no positive equity/balance returned' });
      return;
    }

    const strategies = await strategiesRepo.listActiveStrategies();

    const instruments = [];
    for (const symbol of watchlist) {
      try {
        const [ratesResult, symbolInfo] = await Promise.all([
          connector.getRates(symbol, { timeframe: 'M5', count: M5_BAR_COUNT }),
          connector.getSymbolInfo(symbol),
        ]);
        instruments.push({ symbol, bars: ratesResult.bars, symbolInfo });
      } catch (err) {
        pushDecision({ type: 'data_fetch_error', symbol, message: err.message });
      }
    }

    if (instruments.length === 0) return;

    const result = evaluateM5Tick({ instruments, strategies, balance });

    if (result.outcome === 'opened') {
      openTrade = { ...result.trade, openedAt: new Date().toISOString(), status: 'open' };
      pushDecision({
        type: 'opened',
        symbol: result.trade.symbol,
        direction: result.trade.direction,
        strategyName: result.trade.strategyName,
        lotSize: result.trade.lotSize,
        entryPrice: result.trade.entryPrice,
      });
    } else if (result.outcome === 'skipped_below_volume_min') {
      pushDecision({
        type: 'skipped_below_volume_min',
        symbol: result.symbol,
        direction: result.direction,
        strategyName: result.strategyName,
        reason: result.reason,
        balance: result.balance,
      });
    } else if (result.outcome === 'sizing_error') {
      pushDecision({ type: 'sizing_error', symbol: result.symbol, reason: result.reason });
    }
    // 'no_signal' / 'no_price' — deliberately not logged every tick, to
    // avoid flooding history with the overwhelmingly common no-op case.
  }

  async function tick() {
    tickCount += 1;
    try {
      await monitorOpenTrade();
      await tryOpen();
      lastTickError = null;
    } catch (err) {
      lastTickError = err.message;
      pushDecision({ type: 'tick_error', message: err.message });
    }
  }

  function start() {
    if (status === 'running') return getStatus();
    status = 'running';
    startedAt = new Date().toISOString();
    stoppedAt = null;
    tick().catch(() => {});
    timer = setInterval(() => {
      tick().catch(() => {});
    }, tickMs);
    return getStatus();
  }

  function stop() {
    if (status === 'stopped') return getStatus();
    if (timer) clearInterval(timer);
    timer = null;
    status = 'stopped';
    stoppedAt = new Date().toISOString();
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
      openTrade,
      closedTrades: closedTrades.slice(0, 20),
      decisionLog: decisionLog.slice(0, 50),
      lastTickError,
    };
  }

  function _resetForTests() {
    if (timer) clearInterval(timer);
    timer = null;
    status = 'stopped';
    openTrade = null;
    closedTrades.length = 0;
    decisionLog.length = 0;
    tickCount = 0;
    lastTickError = null;
    startedAt = null;
    stoppedAt = null;
  }

  return { start, stop, tick, getStatus, _resetForTests };
}

// Global singleton — this experiment is a single admin-controlled
// instance, not per-user (mirrors the demo-dispatch config's singleton
// pattern, not `bot_instances`'s per-user rows).
const singleton = createM5PaperHarness();

module.exports = {
  createM5PaperHarness,
  start: singleton.start,
  stop: singleton.stop,
  tick: singleton.tick,
  getStatus: singleton.getStatus,
};
