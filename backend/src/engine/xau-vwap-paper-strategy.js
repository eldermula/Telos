'use strict';

const path = require('path');

const marketIntelligencePath = path.join(__dirname, '..', '..', '..', 'bot', 'market-intelligence', 'src');
const { evaluateMarketIntelligence, InsufficientDataError } = require(
  path.join(marketIntelligencePath, 'marketIntelligence.js')
);

const { computeSyntheticRawLotSize, clampLotSize } = require('./synthetic-lot-clamp');

const tierMatrixPath = path.join(__dirname, '..', '..', '..', 'bot', 'apirs', 'src', 'tierMatrix.js');
const { bootstrapRiskPct, TIER_MATRIX, BOOTSTRAP_UPPER_BALANCE } = require(tierMatrixPath);

/**
 * XAUUSD VWAP p90 stretch-reversion — PAPER-ONLY EXPERIMENT
 * (docs/16_XAU_VWAP_Paper_Experiment.md).
 *
 * Candidate signal from a small (~3.5-day) costed backtest on XAUUSD M5
 * only — NOT proven. Pure math: no network, no DB, no MT5 order APIs.
 * Deliberately imports NOTHING from real-dispatch (`placeOrder`/`closeOrder`,
 * `bot-runtime.js`, `m5-real-*`, confirm-live, `REAL_TRADING_ENABLED`).
 *
 * Signal: intraday VWAP stretch crosses empirical p90 |close−VWAP| (same
 * percentile method as tonight's VWAP probe — threshold recomputed from
 * live bars each evaluation, never hardcoded). Trade toward VWAP on cross.
 * Stop: max(1.5×ATR14, 2.0×live spread). Target: 2R.
 */

const SYMBOL = 'XAUUSD';
const STRATEGY_NAME = 'XAU VWAP p90 Reversion';
const SPREAD_STOP_MULTIPLE = 2.0;
const ATR_STOP_MULTIPLE = 1.5;
const REWARD_RISK_RATIO = 2;
const VWAP_P90 = 0.9;
const MIN_BARS = 100;

function dayKey(unixSec) {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

function attachIntradayVwap(bars) {
  let day = null;
  let cumPV = 0;
  let cumV = 0;
  return bars.map((b) => {
    const k = dayKey(b.time);
    if (k !== day) {
      day = k;
      cumPV = 0;
      cumV = 0;
    }
    const typical = (Number(b.high) + Number(b.low) + Number(b.close)) / 3;
    const vol = Math.max(Number(b.tick_volume) || 0, 1);
    cumPV += typical * vol;
    cumV += vol;
    const vwap = cumPV / cumV;
    const close = Number(b.close);
    return {
      ...b,
      close,
      vwap,
      dist: close - vwap,
      absDist: Math.abs(close - vwap),
      day: k,
    };
  });
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function empiricalP90AbsDist(enriched) {
  const abs = enriched.map((e) => e.absDist).filter((v) => v > 0).sort((a, b) => a - b);
  if (abs.length < 2) return null;
  return percentile(abs, VWAP_P90);
}

/**
 * Same crossing rule as tonight's VWAP probe / costed backtest.
 */
function detectP90Cross(enriched, p90Threshold) {
  if (enriched.length < 2 || !p90Threshold) return null;
  const i = enriched.length - 1;
  const cur = enriched[i];
  const prev = enriched[i - 1];
  const crossed =
    cur.absDist >= p90Threshold && prev.day === cur.day && prev.absDist < p90Threshold;
  if (!crossed) return null;
  const side = Math.sign(cur.dist);
  if (side === 0) return null;
  const direction = side > 0 ? 'SELL' : 'BUY';
  return {
    direction,
    barIndex: i,
    dist: cur.dist,
    absDist: cur.absDist,
    p90Threshold,
  };
}

function liveSpread(symbolInfo) {
  const bid = Number(symbolInfo && symbolInfo.bid);
  const ask = Number(symbolInfo && symbolInfo.ask);
  if (!(bid > 0) || !(ask > bid)) return null;
  return ask - bid;
}

function resolveContractSize(symbolInfo) {
  const fromInfo = Number(symbolInfo && symbolInfo.trade_contract_size);
  if (fromInfo > 0) return fromInfo;
  return 100;
}

function computeAppliedRisk(balance) {
  const bal = Number(balance);
  if (!(bal > 0)) {
    throw new RangeError(`balance must be a positive number, got ${balance}`);
  }
  if (bal < BOOTSTRAP_UPPER_BALANCE) return bootstrapRiskPct(bal);
  return TIER_MATRIX[0].maxRiskCeiling;
}

/**
 * Spread-aware stop — same formula as M1 paper / tonight's costed backtests.
 */
function resolveStopDistance({ currentATR, symbolInfo }) {
  const atrStopDistance = Number(currentATR) * ATR_STOP_MULTIPLE;
  const spread = liveSpread(symbolInfo);
  const spreadFloor = spread != null ? SPREAD_STOP_MULTIPLE * spread : null;
  const stopDistance =
    spreadFloor != null && Number.isFinite(spreadFloor)
      ? Math.max(atrStopDistance, spreadFloor)
      : atrStopDistance;
  return {
    stopDistance,
    atrStopDistance,
    spreadFloor,
    spread,
    flooredBySpread: spreadFloor != null && stopDistance > atrStopDistance + 1e-15,
  };
}

/**
 * @param {{ bars: object[], symbolInfo: object, balance: number }} args
 */
function evaluateXauVwapTick({ bars, symbolInfo, balance }) {
  if (!bars || bars.length < MIN_BARS) {
    return { outcome: 'insufficient_bars', required: MIN_BARS, got: bars?.length ?? 0 };
  }

  const enriched = attachIntradayVwap(bars);
  const p90Threshold = empiricalP90AbsDist(enriched);
  if (!p90Threshold) {
    return { outcome: 'no_signal', reason: 'p90_unavailable' };
  }

  const signal = detectP90Cross(enriched, p90Threshold);
  if (!signal) {
    return { outcome: 'no_signal', p90Threshold };
  }

  const window = bars.slice(signal.barIndex - MIN_BARS + 1, signal.barIndex + 1);
  let mi;
  try {
    mi = evaluateMarketIntelligence(window);
  } catch (err) {
    const reason = err instanceof InsufficientDataError ? 'insufficient_data' : err.message;
    return { outcome: 'data_error', reason };
  }

  if (!symbolInfo || symbolInfo.bid == null || symbolInfo.ask == null) {
    return { outcome: 'no_price', p90Threshold };
  }

  const direction = signal.direction;
  const entryPrice = direction === 'BUY' ? symbolInfo.ask : symbolInfo.bid;
  const stopMeta = resolveStopDistance({
    currentATR: mi.diagnostics.currentATR,
    symbolInfo,
  });
  const sign = direction === 'BUY' ? 1 : -1;
  const stopPrice = entryPrice - sign * stopMeta.stopDistance;
  const targetPrice = entryPrice + sign * stopMeta.stopDistance * REWARD_RISK_RATIO;

  const appliedRisk = computeAppliedRisk(balance);
  const contractSize = resolveContractSize(symbolInfo);

  const raw = computeSyntheticRawLotSize({
    effectiveBalance: balance,
    appliedRisk,
    entryPrice,
    stopPrice,
    contractSize,
  });

  if (raw.reason) {
    return {
      outcome: 'sizing_error',
      symbol: SYMBOL,
      direction,
      reason: raw.reason,
      p90Threshold,
    };
  }

  const clamp = clampLotSize(raw.rawLotSize, symbolInfo);
  if (clamp.skipped) {
    return {
      outcome: 'skipped_below_volume_min',
      symbol: SYMBOL,
      direction,
      strategyName: STRATEGY_NAME,
      reason: clamp.reason,
      rawLotSize: raw.rawLotSize,
      volumeMin: symbolInfo.volume_min,
      balance,
      p90Threshold,
    };
  }

  return {
    outcome: 'opened',
    trade: {
      symbol: SYMBOL,
      direction,
      strategyName: STRATEGY_NAME,
      strategyId: 'xau-vwap-p90-reversion',
      entryPrice,
      stopPrice,
      targetPrice,
      stopDistance: stopMeta.stopDistance,
      lotSize: clamp.size,
      contractSize,
      appliedRisk,
      dollarRisk: raw.dollarRisk,
      balanceSnapshot: balance,
      p90Threshold,
      absDistAtSignal: signal.absDist,
      flooredBySpread: stopMeta.flooredBySpread,
      spreadAtEntry: stopMeta.spread,
    },
    p90Threshold,
  };
}

function evaluateXauVwapMonitor(trade, symbolInfo) {
  if (!symbolInfo || symbolInfo.bid == null || symbolInfo.ask == null) return null;

  const price = trade.direction === 'BUY' ? symbolInfo.bid : symbolInfo.ask;
  const sign = trade.direction === 'BUY' ? 1 : -1;

  const hitTarget = trade.direction === 'BUY' ? price >= trade.targetPrice : price <= trade.targetPrice;
  const hitStop = trade.direction === 'BUY' ? price <= trade.stopPrice : price >= trade.stopPrice;

  if (!hitTarget && !hitStop) return null;

  const closePrice = hitTarget ? trade.targetPrice : trade.stopPrice;
  const pnl = sign * (closePrice - trade.entryPrice) * trade.lotSize * trade.contractSize;

  return { outcome: hitTarget ? 'target_hit' : 'stop_hit', closePrice, pnl };
}

module.exports = {
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
  evaluateXauVwapTick,
  evaluateXauVwapMonitor,
};
