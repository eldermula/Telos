'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeRealLotSize, roundDownToStep } = require('./real-lot-sizing');

const SYMBOL = {
  volume_min: 0.01,
  volume_step: 0.01,
  volume_max: 100,
  trade_contract_size: 100000,
};

test('roundDownToStep never rounds up', () => {
  assert.equal(roundDownToStep(0.019, 0.01), 0.01);
  assert.equal(roundDownToStep(0.01, 0.01), 0.01);
  assert.equal(roundDownToStep(0.099, 0.01), 0.09);
});

test('basic FX size: $100 equity, 1% risk, 10-pip stop → 0.01 lot', () => {
  const result = computeRealLotSize({
    equity: 100,
    appliedRisk: 0.01,
    entryPrice: 1.1,
    stopPrice: 1.099, // 0.001 = 10 pips on EURUSD-style quote
    symbolInfo: SYMBOL,
    maxLot: 1,
  });
  assert.equal(result.lotSize, 0.01);
  assert.equal(result.riskedDollars, 1);
  assert.equal(result.cappedBy, null);
});

test('REAL_MAX_LOT hard ceiling caps oversized raw lots', () => {
  const result = computeRealLotSize({
    equity: 10000,
    appliedRisk: 0.01,
    entryPrice: 1.1,
    stopPrice: 1.099,
    symbolInfo: SYMBOL,
    maxLot: 0.01,
  });
  assert.equal(result.lotSize, 0.01);
  assert.equal(result.cappedBy, 'REAL_MAX_LOT');
});

test('volume_max can cap below REAL_MAX_LOT', () => {
  const result = computeRealLotSize({
    equity: 10000,
    appliedRisk: 0.01,
    entryPrice: 1.1,
    stopPrice: 1.099,
    symbolInfo: { ...SYMBOL, volume_max: 0.02 },
    maxLot: 1,
  });
  assert.equal(result.lotSize, 0.02);
  assert.equal(result.cappedBy, 'volume_max');
});

test('fails closed when computed lot is below volume_min', () => {
  assert.throws(
    () =>
      computeRealLotSize({
        equity: 10,
        appliedRisk: 0.01,
        entryPrice: 1.1,
        stopPrice: 1.09, // wide stop → tiny lots
        symbolInfo: SYMBOL,
        maxLot: 1,
      }),
    /below volume_min/
  );
});

test('fails closed on zero stop distance', () => {
  assert.throws(
    () =>
      computeRealLotSize({
        equity: 100,
        appliedRisk: 0.01,
        entryPrice: 1.1,
        stopPrice: 1.1,
        symbolInfo: SYMBOL,
        maxLot: 0.01,
      }),
    /stopDistance/
  );
});
