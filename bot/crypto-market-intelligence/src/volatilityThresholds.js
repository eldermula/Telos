'use strict';

/**
 * Crypto Increment C — provisional ATR-ratio thresholds for BTC/ETH.
 *
 * Forex Module 2 uses LOW < 0.8 / HIGH > 1.3 (calibrated on FX/gold).
 * docs/11 §1: crypto's sharper regime-switching crosses those breakpoints
 * more often after ratio normalization, over-firing the micro breaker's
 * HIGH arm. Widen the NORMAL band until live OHLC calibration revises it.
 *
 * FLAG for human review after a week of logged crypto ratios exists:
 * these numbers are reasoned starting points, not empirically settled.
 */
const FOREX_VOLATILITY_THRESHOLDS = Object.freeze({
  lowMax: 0.8,
  highMin: 1.3,
  assetClass: 'forex_gold',
});

const CRYPTO_VOLATILITY_THRESHOLDS = Object.freeze({
  lowMax: 0.65,
  highMin: 1.55,
  assetClass: 'crypto',
});

/**
 * @param {number} ratio currentATR / rollingAvgATR
 * @param {{ lowMax: number, highMin: number }} thresholds
 * @returns {'LOW'|'NORMAL'|'HIGH'}
 */
function classifyVolatilityWithThresholds(ratio, thresholds) {
  const r = Number(ratio);
  if (!Number.isFinite(r) || r < 0) {
    throw new TypeError('classifyVolatilityWithThresholds requires a non-negative finite ratio');
  }
  if (!thresholds || !(thresholds.lowMax > 0) || !(thresholds.highMin > thresholds.lowMax)) {
    throw new TypeError('thresholds must provide lowMax < highMin');
  }
  if (r > thresholds.highMin) return 'HIGH';
  if (r < thresholds.lowMax) return 'LOW';
  return 'NORMAL';
}

function classifyCryptoVolatility(ratio) {
  return classifyVolatilityWithThresholds(ratio, CRYPTO_VOLATILITY_THRESHOLDS);
}

function classifyForexVolatility(ratio) {
  return classifyVolatilityWithThresholds(ratio, FOREX_VOLATILITY_THRESHOLDS);
}

module.exports = {
  FOREX_VOLATILITY_THRESHOLDS,
  CRYPTO_VOLATILITY_THRESHOLDS,
  classifyVolatilityWithThresholds,
  classifyCryptoVolatility,
  classifyForexVolatility,
};
