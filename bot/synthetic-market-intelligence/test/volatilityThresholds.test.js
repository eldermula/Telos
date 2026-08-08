'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  SYNTHETIC_VOLATILITY_THRESHOLDS,
  FOREX_VOLATILITY_THRESHOLDS,
  classifySyntheticVolatility,
  classifyForexVolatility,
} = require('../src/volatilityThresholds');
const { SYNTHETIC_WATCHLIST, canonicalSyntheticSymbol } = require('../src/watchlist');

describe('synthetic volatility thresholds (first-cut)', () => {
  it('keeps forex cutoffs at 0.8 / 1.3 for comparison', () => {
    assert.equal(FOREX_VOLATILITY_THRESHOLDS.lowMax, 0.8);
    assert.equal(FOREX_VOLATILITY_THRESHOLDS.highMin, 1.3);
    assert.equal(classifyForexVolatility(1.06), 'NORMAL');
  });

  it('uses probe first-cut 0.95 / 1.05', () => {
    assert.equal(SYNTHETIC_VOLATILITY_THRESHOLDS.lowMax, 0.95);
    assert.equal(SYNTHETIC_VOLATILITY_THRESHOLDS.highMin, 1.05);
    assert.equal(SYNTHETIC_VOLATILITY_THRESHOLDS.assetClass, 'synthetic');
  });

  it('classifies around the tight designed-vol band', () => {
    assert.equal(classifySyntheticVolatility(0.94), 'LOW');
    assert.equal(classifySyntheticVolatility(0.95), 'NORMAL');
    assert.equal(classifySyntheticVolatility(1.05), 'NORMAL');
    assert.equal(classifySyntheticVolatility(1.06), 'HIGH');
  });

  it('exposes the five-symbol first-cut watchlist with exact MT5 names', () => {
    assert.deepEqual(SYNTHETIC_WATCHLIST, [
      'Volatility 10 Index',
      'Volatility 25 Index',
      'Volatility 50 Index',
      'Volatility 75 Index',
      'Volatility 100 Index',
    ]);
    assert.equal(canonicalSyntheticSymbol('volatility 10 index'), 'Volatility 10 Index');
    assert.equal(canonicalSyntheticSymbol('R_10'), null);
  });
});
