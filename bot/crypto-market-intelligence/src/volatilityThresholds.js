'use strict';

/**
 * Crypto Increment C — ATR-ratio thresholds for BTC/ETH.
 *
 * Same Module 2 definition as forex: ratio = Wilder ATR(14) /
 * SMA(last 20 ATR values). Categories: LOW < lowMax, HIGH > highMin,
 * else NORMAL (cutoffs inclusive of NORMAL).
 *
 * Empirical settle (2026-08-08), read-only /rates M15 × 1000 bars each
 * for BTCUSD + ETHUSD on Deriv Demo testing infra (n=1936 ratios):
 *   pooled p10≈0.805, p50≈0.958, p90≈1.252, p95≈1.360
 * Under forex 0.8/1.3 → LOW≈8.9% / HIGH≈7.7% (usable tails).
 * Under provisional 0.65/1.55 → LOW≈0.1% / HIGH≈0.9% (nearly silent).
 *
 * Conclusion: the docs/11 “widen NORMAL” starting point over-corrected
 * for this sample. Absolute crypto ATR is higher, but the ratio is
 * self-normalizing and the observed ratio distribution matches the
 * forex band intent — keep 0.80 / 1.30. Re-run
 * `backend/scripts/calibrate-crypto-vol-c.js` after a major stress
 * window if tails look materially fatter.
 */
const FOREX_VOLATILITY_THRESHOLDS = Object.freeze({
  lowMax: 0.8,
  highMin: 1.3,
  assetClass: 'forex_gold',
});

const CRYPTO_VOLATILITY_THRESHOLDS = Object.freeze({
  lowMax: 0.8,
  highMin: 1.3,
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
