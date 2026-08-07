'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ema } = require('../src/ema');

test('ema: returns all-null series when shorter than the period', () => {
  const result = ema([1, 2, 3], 5);
  assert.deepEqual(result, [null, null, null]);
});

test('ema: seeds the first value as a simple average over the period', () => {
  const result = ema([1, 2, 3, 4, 5], 5);
  assert.equal(result[4], 3);
});

test('ema: tracks a constant series exactly', () => {
  const values = new Array(10).fill(2);
  const result = ema(values, 5);
  for (let i = 4; i < result.length; i += 1) {
    assert.equal(result[i], 2);
  }
});

test('ema: reacts to a step change without exceeding the new level', () => {
  const values = [...new Array(10).fill(1), ...new Array(10).fill(2)];
  const result = ema(values, 5);
  const last = result[result.length - 1];
  assert.ok(last > 1 && last <= 2, `expected EMA to move toward 2 without overshooting, got ${last}`);
});
