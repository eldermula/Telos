'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  CRYPTO_VOLATILITY_THRESHOLDS,
  FOREX_VOLATILITY_THRESHOLDS,
  classifyCryptoVolatility,
  classifyForexVolatility,
} = require('../src/volatilityThresholds');

describe('crypto vs forex volatility thresholds', () => {
  it('keeps forex cutoffs at 0.8 / 1.3', () => {
    assert.equal(FOREX_VOLATILITY_THRESHOLDS.lowMax, 0.8);
    assert.equal(FOREX_VOLATILITY_THRESHOLDS.highMin, 1.3);
    assert.equal(classifyForexVolatility(0.79), 'LOW');
    assert.equal(classifyForexVolatility(0.8), 'NORMAL');
    assert.equal(classifyForexVolatility(1.3), 'NORMAL');
    assert.equal(classifyForexVolatility(1.31), 'HIGH');
  });

  it('settles crypto cutoffs at the same 0.8 / 1.3 after empirical M15 calibration', () => {
    assert.equal(CRYPTO_VOLATILITY_THRESHOLDS.lowMax, 0.8);
    assert.equal(CRYPTO_VOLATILITY_THRESHOLDS.highMin, 1.3);
    assert.equal(CRYPTO_VOLATILITY_THRESHOLDS.assetClass, 'crypto');
  });

  it('classifies crypto identically to forex at the settled cutoffs', () => {
    assert.equal(classifyCryptoVolatility(0.79), 'LOW');
    assert.equal(classifyCryptoVolatility(0.8), 'NORMAL');
    assert.equal(classifyCryptoVolatility(1.3), 'NORMAL');
    assert.equal(classifyCryptoVolatility(1.31), 'HIGH');
    assert.equal(classifyCryptoVolatility(1.4), classifyForexVolatility(1.4));
    assert.equal(classifyCryptoVolatility(0.7), classifyForexVolatility(0.7));
  });

  it('still flags extreme crypto ratios as HIGH/LOW', () => {
    assert.equal(classifyCryptoVolatility(1.56), 'HIGH');
    assert.equal(classifyCryptoVolatility(0.64), 'LOW');
  });
});
