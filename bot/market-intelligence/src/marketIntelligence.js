'use strict';

const path = require('path');

const { wilderATR } = require('./atr');
const { wilderADX } = require('./adx');
// Reuse APIRS's existing Section 4 formula rather than re-deriving it here —
// one source of truth for volatility_penalty, shared by Module 2 and Module 5.
const { computeVolatilityPenalty } = require(
  path.join(__dirname, '..', '..', 'apirs', 'src', 'positionSizing.js')
);

class InsufficientDataError extends Error {}

const DEFAULT_ATR_PERIOD = 14;
const DEFAULT_ATR_ROLLING_PERIOD = 20;
const DEFAULT_ADX_PERIOD = 14;

// 08_Bot_Architecture.md Section 9.0 — the categorical market_volatility
// label and the continuous volatility_penalty both derive from the same
// ATR-vs-rolling-average ratio, so there's one volatility signal, not two
// independently tuned ones.
function classifyVolatility(ratio) {
  if (ratio > 1.3) return 'HIGH';
  if (ratio < 0.8) return 'LOW';
  return 'NORMAL';
}

function lastNonNull(series) {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i] !== null && series[i] !== undefined) return { value: series[i], index: i };
  }
  return null;
}

function rollingAverage(series, uptoIndex, windowSize) {
  const values = [];
  for (let i = uptoIndex; i >= 0 && values.length < windowSize; i -= 1) {
    if (series[i] === null || series[i] === undefined) break;
    values.push(series[i]);
  }
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Module 2 — Market Intelligence Worker (08_Bot_Architecture.md
 * Section 9.0/9.2). Pure function: given chronological OHLC bars
 * (oldest first) for one watchlist instrument, returns the
 * environment-dictionary fields Section 10 expects for that
 * instrument. Run once per instrument in the watchlist (Section 9.0);
 * this module itself is instrument-agnostic — it just processes
 * whatever bars it's given.
 *
 * Throws InsufficientDataError if `bars` doesn't cover enough history
 * to produce a real ADX/ATR reading. The caller decides what to do
 * about that (Section 9.1's existing failure fallback: neutral
 * trend_quality, forced HIGH volatility) — this module doesn't guess.
 */
function evaluateMarketIntelligence(bars, options = {}) {
  const atrPeriod = options.atrPeriod || DEFAULT_ATR_PERIOD;
  const atrRollingPeriod = options.atrRollingPeriod || DEFAULT_ATR_ROLLING_PERIOD;
  const adxPeriod = options.adxPeriod || DEFAULT_ADX_PERIOD;

  const minBarsNeeded = Math.max(atrPeriod + atrRollingPeriod, adxPeriod * 2);
  if (!Array.isArray(bars) || bars.length < minBarsNeeded) {
    throw new InsufficientDataError(
      `evaluateMarketIntelligence needs at least ${minBarsNeeded} bars, got ${bars ? bars.length : 0}`
    );
  }

  const atrSeries = wilderATR(bars, atrPeriod);
  const adxSeries = wilderADX(bars, adxPeriod);

  const latestATR = lastNonNull(atrSeries);
  const latestADX = lastNonNull(adxSeries);
  if (!latestATR || !latestADX) {
    throw new InsufficientDataError('ATR/ADX series produced no usable value for the given bars');
  }

  const rollingAvgATR = rollingAverage(atrSeries, latestATR.index, atrRollingPeriod);
  const hasRollingAvg = Number.isFinite(rollingAvgATR) && rollingAvgATR > 0;
  const ratio = hasRollingAvg ? latestATR.value / rollingAvgATR : 1;
  const volatility_penalty = hasRollingAvg
    ? computeVolatilityPenalty({ currentATR: latestATR.value, rollingAvgATR })
    : 0;
  const market_volatility = classifyVolatility(ratio);

  const trend_quality = Math.max(0, Math.min(1, latestADX.value / 50));

  return {
    trend_quality,
    market_volatility,
    volatility_penalty,
    diagnostics: {
      currentATR: latestATR.value,
      rollingAvgATR,
      currentADX: latestADX.value,
      volatilityRatio: ratio,
    },
  };
}

module.exports = { evaluateMarketIntelligence, classifyVolatility, InsufficientDataError };
