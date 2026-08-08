'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeCryptoContractSpec,
  toRealLotSizingSymbolInfo,
  isCryptoSymbol,
} = require('./crypto-contract-specs');
const { computeRealLotSize } = require('./real-lot-sizing');

describe('crypto-contract-specs', () => {
  it('recognizes BTC/ETH only', () => {
    assert.equal(isCryptoSymbol('BTCUSD'), true);
    assert.equal(isCryptoSymbol('ETHUSD'), true);
    assert.equal(isCryptoSymbol('EURUSD'), false);
  });

  it('refuses sizing when trade_contract_size is missing', () => {
    const n = normalizeCryptoContractSpec({
      symbol: 'BTCUSD',
      volume_min: 0.01,
      volume_max: 10,
      volume_step: 0.01,
    });
    assert.equal(n.sizingReady, false);
    assert.match(n.reason, /trade_contract_size missing/);
    assert.throws(() => toRealLotSizingSymbolInfo(n), /not sizing-ready/);
  });

  it('accepts a real crypto CFD-shaped spec and sizes via computeRealLotSize', () => {
    const n = normalizeCryptoContractSpec({
      symbol: 'btcusd',
      volume_min: 0.01,
      volume_max: 5,
      volume_step: 0.01,
      trade_contract_size: 1,
      digits: 2,
      point: 0.01,
    });
    assert.equal(n.sizingReady, true);
    const info = toRealLotSizingSymbolInfo(n);
    const sized = computeRealLotSize({
      equity: 10000,
      appliedRisk: 0.01,
      entryPrice: 60000,
      stopPrice: 59000,
      symbolInfo: info,
      maxLot: 0.5,
    });
    // risked 100 / (1 * 1000) = 0.1 lots
    assert.equal(sized.lotSize, 0.1);
  });
});
