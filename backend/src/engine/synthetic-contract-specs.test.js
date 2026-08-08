'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSyntheticContractSpec,
  toRealLotSizingSymbolInfo,
  isSyntheticSymbol,
  SYNTHETIC_SYMBOLS,
} = require('./synthetic-contract-specs');
const { computeRealLotSize } = require('./real-lot-sizing');

describe('synthetic-contract-specs', () => {
  it('recognizes first-cut Volatility Index names only', () => {
    assert.equal(isSyntheticSymbol('Volatility 10 Index'), true);
    assert.equal(isSyntheticSymbol('volatility 100 index'), true);
    assert.equal(isSyntheticSymbol('BTCUSD'), false);
    assert.equal(isSyntheticSymbol('Boom 300 Index'), false);
    assert.equal(SYNTHETIC_SYMBOLS.length, 5);
  });

  it('refuses sizing when trade_contract_size is missing', () => {
    const n = normalizeSyntheticContractSpec({
      symbol: 'Volatility 10 Index',
      volume_min: 0.5,
      volume_max: 400,
      volume_step: 0.01,
    });
    assert.equal(n.sizingReady, false);
    assert.match(n.reason, /trade_contract_size missing/);
    assert.throws(() => toRealLotSizingSymbolInfo(n), /not sizing-ready/);
  });

  it('accepts a Deriv Volatility Index shaped spec', () => {
    const n = normalizeSyntheticContractSpec({
      symbol: 'volatility 75 index',
      volume_min: 0.01,
      volume_max: 15,
      volume_step: 0.001,
      trade_contract_size: 1,
      digits: 2,
      point: 0.01,
    });
    assert.equal(n.sizingReady, true);
    assert.equal(n.symbol, 'Volatility 75 Index');
    const info = toRealLotSizingSymbolInfo(n);
    const sized = computeRealLotSize({
      equity: 10000,
      appliedRisk: 0.01,
      entryPrice: 49000,
      stopPrice: 48500,
      symbolInfo: info,
      maxLot: 1,
    });
    assert.ok(sized.lotSize >= n.volume_min);
  });
});
