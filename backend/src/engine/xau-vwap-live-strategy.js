'use strict';

/**
 * XAUUSD VWAP p90 stretch-reversion — CONTROLLED REAL-MONEY STRATEGY MATH
 * (docs/17_XAU_VWAP_Live_Strategy.md).
 *
 * Scope: XAUUSD + M5 ONLY. Generates a trade INTENT only — never places
 * broker orders. Live execution is exclusively via xau-vwap-live-dispatch.js
 * → existing mt5-connector placeOrder/closeOrder path.
 *
 * Reuses the validated paper-strategy VWAP / empirical-p90 / stop / 2R math
 * (xau-vwap-paper-strategy.js) with STRICTER fail-closed guards for live:
 * missing/invalid live spread, missing ATR, stale bars → DO NOT TRADE.
 *
 * Historical/paper E[R] numbers are NOT hardcoded into execution.
 */

const {
  SYMBOL,
  STRATEGY_NAME,
  SPREAD_STOP_MULTIPLE,
  ATR_STOP_MULTIPLE,
  REWARD_RISK_RATIO,
  MIN_BARS,
  attachIntradayVwap,
  empiricalP90AbsDist,
  detectP90Cross,
  resolveStopDistance,
  computeAppliedRisk,
  evaluateXauVwapTick: evaluatePaperTick,
} = require('./xau-vwap-paper-strategy');

/** Max age of the newest bar timestamp vs wall clock before rejecting as stale. */
const MAX_BAR_STALENESS_MS = Number(process.env.XAU_VWAP_LIVE_MAX_BAR_STALENESS_MS) || 15 * 60 * 1000;

function liveSpread(symbolInfo) {
  const bid = Number(symbolInfo && symbolInfo.bid);
  const ask = Number(symbolInfo && symbolInfo.ask);
  if (!(bid > 0) || !(ask > bid)) return null;
  return ask - bid;
}

/**
 * Fail-closed staleness: newest bar must be recent enough relative to now.
 * @param {object[]} bars
 * @param {() => Date} [now]
 */
function assertBarsFresh(bars, now = () => new Date()) {
  if (!bars || bars.length === 0) {
    return { ok: false, reason: 'no_bars' };
  }
  const last = bars[bars.length - 1];
  const barMs = Number(last.time) * 1000;
  if (!(barMs > 0)) {
    return { ok: false, reason: 'invalid_bar_time' };
  }
  const ageMs = now().getTime() - barMs;
  if (!(ageMs >= 0) || ageMs > MAX_BAR_STALENESS_MS) {
    return { ok: false, reason: 'stale_market_data', ageMs, maxAgeMs: MAX_BAR_STALENESS_MS };
  }
  return { ok: true, ageMs };
}

/**
 * Live evaluation — same signal as paper, but rejects missing spread/ATR
 * and stale bars before returning an openable intent.
 *
 * @param {{ bars: object[], symbolInfo: object, balance: number, now?: () => Date }} args
 */
function evaluateXauVwapLiveTick({ bars, symbolInfo, balance, now }) {
  const freshness = assertBarsFresh(bars, now || (() => new Date()));
  if (!freshness.ok) {
    return { outcome: 'stale_market_data', reason: freshness.reason, details: freshness };
  }

  const spread = liveSpread(symbolInfo);
  if (spread == null || !(spread > 0)) {
    return { outcome: 'invalid_spread', reason: 'live_spread_unavailable' };
  }

  const decision = evaluatePaperTick({ bars, symbolInfo, balance });

  if (decision.outcome !== 'opened') {
    return decision;
  }

  const trade = decision.trade;
  if (!(trade.spreadAtEntry > 0)) {
    return { outcome: 'invalid_spread', reason: 'spread_missing_after_signal' };
  }
  if (!(trade.stopDistance > 0)) {
    return { outcome: 'invalid_stop', reason: 'stop_distance_unavailable' };
  }
  if (!(Number(trade.stopPrice) > 0) || !(Number(trade.targetPrice) > 0)) {
    return { outcome: 'invalid_stop', reason: 'stop_or_target_invalid' };
  }

  // Snapshot fields for admin / audit (computed fresh; never hardcoded).
  const enriched = attachIntradayVwap(bars);
  const last = enriched[enriched.length - 1];
  return {
    ...decision,
    marketSnapshot: {
      symbol: SYMBOL,
      timeframe: 'M5',
      vwap: last.vwap,
      p90Threshold: trade.p90Threshold,
      close: last.close,
      absDist: last.absDist,
      spread: trade.spreadAtEntry,
      stopDistance: trade.stopDistance,
      targetDistance: trade.stopDistance * REWARD_RISK_RATIO,
      appliedRisk: trade.appliedRisk,
      lotSize: trade.lotSize,
    },
  };
}

/**
 * Pure snapshot for admin UI when there is no open signal.
 */
function buildLiveMarketSnapshot({ bars, symbolInfo }) {
  if (!bars || bars.length < MIN_BARS) {
    return { ok: false, reason: 'insufficient_bars', got: bars?.length ?? 0 };
  }
  const enriched = attachIntradayVwap(bars);
  const p90Threshold = empiricalP90AbsDist(enriched);
  const last = enriched[enriched.length - 1];
  const spread = liveSpread(symbolInfo);
  return {
    ok: true,
    symbol: SYMBOL,
    timeframe: 'M5',
    vwap: last.vwap,
    p90Threshold,
    close: last.close,
    absDist: last.absDist,
    spread,
    barTime: last.time,
  };
}

module.exports = {
  SYMBOL,
  STRATEGY_NAME,
  STRATEGY_ID: 'xau-vwap-p90-reversion-live',
  SPREAD_STOP_MULTIPLE,
  ATR_STOP_MULTIPLE,
  REWARD_RISK_RATIO,
  MIN_BARS,
  MAX_BAR_STALENESS_MS,
  attachIntradayVwap,
  empiricalP90AbsDist,
  detectP90Cross,
  resolveStopDistance,
  computeAppliedRisk,
  liveSpread,
  assertBarsFresh,
  evaluateXauVwapLiveTick,
  buildLiveMarketSnapshot,
};
