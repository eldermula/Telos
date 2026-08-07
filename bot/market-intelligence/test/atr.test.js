'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { wilderATR } = require('../src/atr');
const { flatBars, volatilitySpikeBars, trendingBars } = require('./fixtures');

test('wilderATR returns null for the first period-1 entries', () => {
  const bars = trendingBars(20);
  const atr = wilderATR(bars, 14);
  for (let i = 0; i < 13; i += 1) {
    assert.equal(atr[i], null);
  }
  assert.notEqual(atr[13], null);
});

test('wilderATR returns all-null when there are fewer than `period` bars', () => {
  const bars = trendingBars(5);
  const atr = wilderATR(bars, 14);
  assert.equal(atr.length, 5);
  assert.ok(atr.every((v) => v === null));
});

test('wilderATR on a perfectly flat series is zero (no divide-by-zero, no NaN)', () => {
  const bars = flatBars(30);
  const atr = wilderATR(bars, 14);
  const last = atr[atr.length - 1];
  assert.equal(last, 0);
});

test('wilderATR rises once a volatility spike enters the smoothing window', () => {
  const bars = volatilitySpikeBars(40, { spikeLength: 8 });
  const atr = wilderATR(bars, 14);
  const calmATR = atr[bars.length - 9]; // just before the spike enters
  const spikedATR = atr[bars.length - 1];
  assert.ok(spikedATR > calmATR, `expected spiked ATR (${spikedATR}) > calm ATR (${calmATR})`);
});
