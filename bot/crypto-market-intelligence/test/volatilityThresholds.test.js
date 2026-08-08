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

  it('uses a wider NORMAL band for crypto', () => {
    assert.ok(CRYPTO_VOLATILITY_THRESHOLDS.lowMax < FOREX_VOLATILITY_THRESHOLDS.lowMax);
    assert.ok(CRYPTO_VOLATILITY_THRESHOLDS.highMin > FOREX_VOLATILITY_THRESHOLDS.highMin);
  });

  it('classifies the ratio that is HIGH on forex but NORMAL on crypto', () => {
    const midHigh = 1.4; // > 1.3 forex HIGH, < 1.55 crypto NORMAL
    assert.equal(classifyForexVolatility(midHigh), 'HIGH');
    assert.equal(classifyCryptoVolatility(midHigh), 'NORMAL');
  });

  it('classifies the ratio that is LOW on forex but NORMAL on crypto', () => {
    const midLow = 0.7; // < 0.8 forex LOW, > 0.65 crypto NORMAL
    assert.equal(classifyForexVolatility(midLow), 'LOW');
    assert.equal(classifyCryptoVolatility(midLow), 'NORMAL');
  });

  it('still flags extreme crypto ratios as HIGH/LOW', () => {
    assert.equal(classifyCryptoVolatility(1.56), 'HIGH');
    assert.equal(classifyCryptoVolatility(0.64), 'LOW');
  });
});
