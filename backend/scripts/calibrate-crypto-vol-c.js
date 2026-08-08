'use strict';

/**
 * Crypto Increment C — empirical ATR-ratio calibration from live /rates.
 * Read-only. BTCUSD + ETHUSD only (no synthetics, no orders).
 *
 *   node backend/scripts/calibrate-crypto-vol-c.js
 *
 * Reuses Module 2 math: Wilder ATR(14) / SMA(last 20 ATR values), M15.
 */

const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const { getRates } = require('../src/services/mt5-connector.client');
const { wilderATR } = require(path.join(
  __dirname,
  '..',
  '..',
  'bot',
  'market-intelligence',
  'src',
  'atr.js'
));
const {
  CRYPTO_VOLATILITY_THRESHOLDS,
  FOREX_VOLATILITY_THRESHOLDS,
  classifyCryptoVolatility,
  classifyForexVolatility,
} = require(path.join(
  __dirname,
  '..',
  '..',
  'bot',
  'crypto-market-intelligence',
  'src',
  'volatilityThresholds.js'
));

const ATR_PERIOD = 14;
const ATR_ROLLING = 20;
const SYMBOLS = ['BTCUSD', 'ETHUSD'];
const TIMEFRAME = 'M15';
const COUNT = 1000; // connector max

function rollingAverage(series, uptoIndex, windowSize) {
  const values = [];
  for (let i = uptoIndex; i >= 0 && values.length < windowSize; i -= 1) {
    if (series[i] === null || series[i] === undefined) break;
    values.push(series[i]);
  }
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function ratiosFromBars(bars) {
  const atrSeries = wilderATR(bars, ATR_PERIOD);
  const ratios = [];
  // First usable ATR at index ATR_PERIOD-1; need ATR_ROLLING values → start at ATR_PERIOD-1+ATR_ROLLING-1
  const start = ATR_PERIOD - 1 + ATR_ROLLING - 1;
  for (let i = start; i < atrSeries.length; i += 1) {
    const atr = atrSeries[i];
    if (atr === null || atr === undefined || !(atr > 0)) continue;
    const avg = rollingAverage(atrSeries, i, ATR_ROLLING);
    if (!Number.isFinite(avg) || !(avg > 0)) continue;
    ratios.push(atr / avg);
  }
  return ratios;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function classifyCounts(ratios, classifyFn) {
  const counts = { LOW: 0, NORMAL: 0, HIGH: 0 };
  for (const r of ratios) counts[classifyFn(r)] += 1;
  const n = ratios.length || 1;
  return {
    counts,
    pct: {
      LOW: counts.LOW / n,
      NORMAL: counts.NORMAL / n,
      HIGH: counts.HIGH / n,
    },
  };
}

function summarize(name, ratios) {
  const sorted = [...ratios].sort((a, b) => a - b);
  const forex = classifyCounts(ratios, classifyForexVolatility);
  const crypto = classifyCounts(ratios, classifyCryptoVolatility);
  return {
    symbol: name,
    n: ratios.length,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
    mean: ratios.length ? ratios.reduce((s, v) => s + v, 0) / ratios.length : null,
    p05: percentile(sorted, 0.05),
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    forexBands: FOREX_VOLATILITY_THRESHOLDS,
    cryptoBands: CRYPTO_VOLATILITY_THRESHOLDS,
    underForex: forex,
    underCrypto: crypto,
  };
}

async function main() {
  const perSymbol = [];
  const pooled = [];

  for (const symbol of SYMBOLS) {
    const body = await getRates(symbol, { timeframe: TIMEFRAME, count: COUNT });
    const bars = body.bars || [];
    if (bars.length < ATR_PERIOD + ATR_ROLLING) {
      throw new Error(`${symbol}: insufficient bars (${bars.length})`);
    }
    const ratios = ratiosFromBars(bars);
    pooled.push(...ratios);
    const summary = summarize(symbol, ratios);
    summary.barsFetched = bars.length;
    summary.timeframe = body.timeframe || TIMEFRAME;
    summary.firstBarTime = bars[0] && bars[0].time;
    summary.lastBarTime = bars[bars.length - 1] && bars[bars.length - 1].time;
    perSymbol.push(summary);
  }

  const pooledSummary = summarize('BTCUSD+ETHUSD', pooled);

  // Proposed bands from pooled empirical tails: ~10th / ~90th percentile,
  // rounded to 0.05 — same spirit as widening NORMAL for fatter regime tails.
  const proposedLow = Math.round(pooledSummary.p10 * 20) / 20;
  const proposedHigh = Math.round(pooledSummary.p90 * 20) / 20;

  const report = {
    method: {
      timeframe: TIMEFRAME,
      countRequested: COUNT,
      atrPeriod: ATR_PERIOD,
      atrRollingPeriod: ATR_ROLLING,
      ratio: 'currentATR / SMA(last ATR_ROLLING ATR values incl. current)',
      symbols: SYMBOLS,
      note: 'Read-only /rates; no synthetics; no orders',
    },
    perSymbol,
    pooled: pooledSummary,
    recommendation: {
      provisional: CRYPTO_VOLATILITY_THRESHOLDS,
      empiricalP10P90Rounded: { lowMax: proposedLow, highMin: proposedHigh },
      // Decision filled after inspecting numbers in the printed report.
    },
  };

  console.log(JSON.stringify(report, null, 2));

  // Human-readable decision aid
  const fxHigh = pooledSummary.underForex.pct.HIGH;
  const crHigh = pooledSummary.underCrypto.pct.HIGH;
  const fxLow = pooledSummary.underForex.pct.LOW;
  const crLow = pooledSummary.underCrypto.pct.LOW;
  console.log('---');
  console.log(
    `POOLED n=${pooledSummary.n} p10=${pooledSummary.p10.toFixed(3)} p50=${pooledSummary.p50.toFixed(3)} p90=${pooledSummary.p90.toFixed(3)}`
  );
  const fx = FOREX_VOLATILITY_THRESHOLDS;
  const cr = CRYPTO_VOLATILITY_THRESHOLDS;
  console.log(
    `FOREX ${fx.lowMax}/${fx.highMin}  → LOW ${(fxLow * 100).toFixed(1)}%  NORMAL ${(pooledSummary.underForex.pct.NORMAL * 100).toFixed(1)}%  HIGH ${(fxHigh * 100).toFixed(1)}%`
  );
  console.log(
    `CRYPTO ${cr.lowMax}/${cr.highMin} → LOW ${(crLow * 100).toFixed(1)}%  NORMAL ${(pooledSummary.underCrypto.pct.NORMAL * 100).toFixed(1)}%  HIGH ${(crHigh * 100).toFixed(1)}%`
  );
  console.log(`EMPIRICAL p10/p90 rounded → ${proposedLow} / ${proposedHigh}`);
  console.log('CRYPTO_VOL_C_CALIBRATE_DONE');
}

main().catch((err) => {
  console.error('CRYPTO_VOL_C_CALIBRATE_FAIL', err && err.message ? err.message : err);
  process.exitCode = 1;
});
