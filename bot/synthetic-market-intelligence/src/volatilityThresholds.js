'use strict';

/**
 * Synthetics first-cut ATR-ratio thresholds (docs/13 probe).
 *
 * Same Module 2 definition as forex/crypto: ratio = Wilder ATR(14) /
 * SMA(last 20 ATR). Categories: LOW < lowMax, HIGH > highMin, else NORMAL.
 *
 * Live probe (Deriv-Demo, M15 × 1000 bars, Volatility 5–100 Index):
 *   ratio p10/p50/p90 ≈ 0.94 / 1.00 / 1.06 on every variant
 *   forex 0.8/1.3 → HIGH share 0.0% (regime gate starves breakout)
 * Absolute ATR% of price *does* scale with the index number; the ratio
 * does not. First-cut band = empirical p10/p90 rounded to 0.05:
 *   lowMax=0.95 / highMin=1.05
 *
 * Flagged: this may be the wrong primary regime axis for designed-fixed
 * vol — revisit before treating as final calibration.
 */
const FOREX_VOLATILITY_THRESHOLDS = Object.freeze({
  lowMax: 0.8,
  highMin: 1.3,
  assetClass: 'forex_gold',
});

const SYNTHETIC_VOLATILITY_THRESHOLDS = Object.freeze({
  lowMax: 0.95,
  highMin: 1.05,
  assetClass: 'synthetic',
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

function classifySyntheticVolatility(ratio) {
  return classifyVolatilityWithThresholds(ratio, SYNTHETIC_VOLATILITY_THRESHOLDS);
}

function classifyForexVolatility(ratio) {
  return classifyVolatilityWithThresholds(ratio, FOREX_VOLATILITY_THRESHOLDS);
}

module.exports = {
  FOREX_VOLATILITY_THRESHOLDS,
  SYNTHETIC_VOLATILITY_THRESHOLDS,
  classifyVolatilityWithThresholds,
  classifySyntheticVolatility,
  classifyForexVolatility,
};
