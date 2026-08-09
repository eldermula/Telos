'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeRealLotSize,
  roundDownToStep,
  DEFAULT_FX_CONTRACT_SIZE,
  DEFAULT_GOLD_CONTRACT_SIZE,
} = require('./real-lot-sizing');

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
    symbol: 'EURUSD',
    symbolInfo: SYMBOL,
    maxLot: 1,
  });
  assert.equal(result.lotSize, 0.01);
  assert.equal(result.riskedDollars, 1);
  assert.equal(result.cappedBy, null);
  assert.equal(result.usedContractSizeFallback, false);
});

test('REAL_MAX_LOT hard ceiling caps oversized raw lots', () => {
  const result = computeRealLotSize({
    equity: 10000,
    appliedRisk: 0.01,
    entryPrice: 1.1,
    stopPrice: 1.099,
    symbol: 'EURUSD',
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
    symbol: 'EURUSD',
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
        symbol: 'EURUSD',
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
        symbol: 'EURUSD',
        symbolInfo: SYMBOL,
        maxLot: 0.01,
      }),
    /stopDistance/
  );
});

test('XAUUSD uses live trade_contract_size=100 when present (no fallback)', () => {
  const result = computeRealLotSize({
    equity: 10000,
    appliedRisk: 0.01,
    entryPrice: 2000,
    stopPrice: 1990, // 10-point stop
    symbol: 'XAUUSD',
    symbolInfo: {
      volume_min: 0.01,
      volume_step: 0.01,
      volume_max: 10,
      trade_contract_size: 100,
    },
    maxLot: 1,
  });
  // risked=100, contract=100, stop=10 → lots = 0.1
  assert.equal(result.lotSize, 0.1);
  assert.equal(result.contractSize, 100);
  assert.equal(result.usedContractSizeFallback, false);
});

test('XAUUSD missing trade_contract_size uses gold fallback 100 — not FX 100000', () => {
  const result = computeRealLotSize({
    equity: 10000,
    appliedRisk: 0.01,
    entryPrice: 2000,
    stopPrice: 1990,
    symbol: 'XAUUSD',
    symbolInfo: {
      volume_min: 0.01,
      volume_step: 0.01,
      volume_max: 10,
      // deliberately omit trade_contract_size
    },
    maxLot: 1,
  });
  assert.equal(result.contractSize, DEFAULT_GOLD_CONTRACT_SIZE);
  assert.equal(result.usedContractSizeFallback, true);
  assert.equal(result.lotSize, 0.1);
  // Wrong FX default would yield 100/(100000*10)=0.0001 → below volume_min → throw
  assert.notEqual(result.contractSize, DEFAULT_FX_CONTRACT_SIZE);
});

test('XAUUSD with trade_contract_size=0 also uses gold fallback', () => {
  const result = computeRealLotSize({
    equity: 10000,
    appliedRisk: 0.01,
    entryPrice: 2000,
    stopPrice: 1990,
    symbol: 'XAUUSD',
    symbolInfo: {
      volume_min: 0.01,
      volume_step: 0.01,
      volume_max: 10,
      trade_contract_size: 0,
    },
    maxLot: 1,
  });
  assert.equal(result.contractSize, DEFAULT_GOLD_CONTRACT_SIZE);
  assert.equal(result.usedContractSizeFallback, true);
});

test('EURUSD missing trade_contract_size still falls back to FX 100000', () => {
  const result = computeRealLotSize({
    equity: 100,
    appliedRisk: 0.01,
    entryPrice: 1.1,
    stopPrice: 1.099,
    symbol: 'EURUSD',
    symbolInfo: {
      volume_min: 0.01,
      volume_step: 0.01,
      volume_max: 100,
    },
    maxLot: 1,
  });
  assert.equal(result.contractSize, DEFAULT_FX_CONTRACT_SIZE);
  assert.equal(result.usedContractSizeFallback, true);
  assert.equal(result.lotSize, 0.01);
});
