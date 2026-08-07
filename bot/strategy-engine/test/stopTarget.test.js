'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeStopTarget } = require('../src/stopTarget');

test('computeStopTarget: BUY places stop below entry and target above, scaled by ATR multiple', () => {
  const result = computeStopTarget({
    entryPrice: 1.1,
    direction: 'BUY',
    currentATR: 0.002,
    stopRule: { multiple: 1.5 },
    targetRule: { ratio: 2 },
  });
  assert.equal(result.stopDistance, 0.003);
  assert.ok(Math.abs(result.stopPrice - 1.097) < 1e-9);
  assert.ok(Math.abs(result.targetPrice - 1.106) < 1e-9);
});

test('computeStopTarget: SELL mirrors BUY — stop above entry, target below', () => {
  const result = computeStopTarget({
    entryPrice: 1.1,
    direction: 'SELL',
    currentATR: 0.002,
    stopRule: { multiple: 1.5 },
    targetRule: { ratio: 2 },
  });
  assert.ok(Math.abs(result.stopPrice - 1.103) < 1e-9);
  assert.ok(Math.abs(result.targetPrice - 1.094) < 1e-9);
});

test('computeStopTarget: works identically for a JPY-scale price and a gold-scale price (pure price-level math)', () => {
  const jpy = computeStopTarget({
    entryPrice: 150.0,
    direction: 'BUY',
    currentATR: 0.15,
    stopRule: { multiple: 1.5 },
    targetRule: { ratio: 2 },
  });
  assert.ok(Math.abs(jpy.stopPrice - 149.775) < 1e-9);

  const gold = computeStopTarget({
    entryPrice: 2400.0,
    direction: 'BUY',
    currentATR: 3.0,
    stopRule: { multiple: 1.5 },
    targetRule: { ratio: 2 },
  });
  assert.ok(Math.abs(gold.stopPrice - 2395.5) < 1e-9);
});

test('computeStopTarget: falls back to documented defaults when stop/target rules are missing', () => {
  const result = computeStopTarget({ entryPrice: 1.1, direction: 'BUY', currentATR: 0.001 });
  assert.equal(result.stopDistance, 0.0015);
  assert.ok(Math.abs(result.targetPrice - (1.1 + 0.003)) < 1e-9);
});
