'use strict';

const path = require('path');
const mt5Connector = require('../services/mt5-connector.client');
const { evaluateXauVwapTick, evaluateXauVwapMonitor, SYMBOL } = require('./xau-vwap-paper-strategy');

const DEFAULT_TICK_MS = Number(process.env.XAU_VWAP_PAPER_TICK_MS) || 15000;
const BAR_COUNT = Number(process.env.XAU_VWAP_PAPER_BAR_COUNT) || 1000;
const MAX_HISTORY = 200;

/**
 * XAUUSD VWAP p90 stretch-reversion — PAPER-ONLY harness
 * (docs/16_XAU_VWAP_Paper_Experiment.md).
 *
 * Global admin singleton, in-memory only. XAUUSD + M5 only — the only
 * combination costed tonight with n>=15 and positive E[R] (still a small
 * sample, not proven).
 *
 * HARD BOUNDARY: only read-only connector calls (`getRates`, `getSymbolInfo`,
 * `getAccountInfo`). Never imports `placeOrder`/`closeOrder`, `bot-runtime.js`,
 * `m5-real-*`, confirm-live, or any real-trading env flag.
 */
function createXauVwapPaperHarness(deps = {}) {
  const connector = deps.mt5Connector || mt5Connector;
  const tickMs = deps.tickMs || DEFAULT_TICK_MS;
  const barCount = deps.barCount || BAR_COUNT;

  let status = 'stopped';
  let startedAt = null;
  let stoppedAt = null;
  let timer = null;
  let openTrade = null;
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
      symbolInfo = await connector.getSymbolInfo(SYMBOL);
    } catch (err) {
      pushDecision({ type: 'monitor_error', symbol: SYMBOL, message: err.message });
      return;
    }

    const result = evaluateXauVwapMonitor(openTrade, symbolInfo);
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
      symbol: SYMBOL,
      direction: openTrade.direction,
      pnl: result.pnl,
    });
    openTrade = null;
  }

  async function tryOpen() {
    if (openTrade) return;

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

    let bars;
    let symbolInfo;
    try {
      const [ratesResult, info] = await Promise.all([
        connector.getRates(SYMBOL, { timeframe: 'M5', count: barCount }),
        connector.getSymbolInfo(SYMBOL),
      ]);
      bars = ratesResult.bars;
      symbolInfo = info;
    } catch (err) {
      pushDecision({ type: 'data_fetch_error', symbol: SYMBOL, message: err.message });
      return;
    }

    if (!bars || bars.length === 0) {
      pushDecision({ type: 'data_fetch_error', symbol: SYMBOL, message: 'empty bars' });
      return;
    }

    const result = evaluateXauVwapTick({ bars, symbolInfo, balance });

    if (result.outcome === 'opened') {
      openTrade = { ...result.trade, openedAt: new Date().toISOString(), status: 'open' };
      pushDecision({
        type: 'opened',
        symbol: result.trade.symbol,
        direction: result.trade.direction,
        strategyName: result.trade.strategyName,
        lotSize: result.trade.lotSize,
        entryPrice: result.trade.entryPrice,
        p90Threshold: result.trade.p90Threshold,
      });
    } else if (result.outcome === 'skipped_below_volume_min') {
      pushDecision({
        type: 'skipped_below_volume_min',
        symbol: result.symbol,
        direction: result.direction,
        strategyName: result.strategyName,
        reason: result.reason,
        balance: result.balance,
        p90Threshold: result.p90Threshold,
      });
    } else if (result.outcome === 'sizing_error') {
      pushDecision({ type: 'sizing_error', symbol: result.symbol, reason: result.reason });
    } else if (result.outcome === 'data_error') {
      pushDecision({ type: 'data_error', message: result.reason });
    }
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
    if (typeof timer.unref === 'function') timer.unref();
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
      symbol: SYMBOL,
      timeframe: 'M5',
      barCount,
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

const singleton = createXauVwapPaperHarness();

module.exports = {
  createXauVwapPaperHarness,
  start: singleton.start,
  stop: singleton.stop,
  tick: singleton.tick,
  getStatus: singleton.getStatus,
};
