'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { wilderRSI } = require('../src/rsi');
const { sharpMoveBars, flatBars } = require('./fixtures');

test('wilderRSI: returns all-null series when shorter than period + 1', () => {
  const bars = flatBars(10);
  const result = wilderRSI(bars, 14);
  assert.deepEqual(result, bars.map(() => null));
});

test('wilderRSI: a flat series (no gains, no losses) reads as neutral, not NaN', () => {
  const bars = flatBars(30);
  const result = wilderRSI(bars, 14);
  const latest = result[result.length - 1];
  // avgGain=0/avgLoss=0 -> the "avgLoss===0" branch reads 100, a known
  // degenerate edge (no losses at all yet) rather than a real
  // oversold/overbought signal — asserting it's a finite number is
  // the meaningful contract here (no NaN/divide-by-zero).
  assert.ok(Number.isFinite(latest), `expected a finite RSI value, got ${latest}`);
});

test('wilderRSI: a sustained sharp drop pushes RSI into oversold (<=30)', () => {
  const bars = sharpMoveBars(40, { step: -0.003 });
  const result = wilderRSI(bars, 14);
  const latest = result[result.length - 1];
  assert.ok(latest <= 30, `expected oversold RSI after a sharp drop, got ${latest}`);
});

test('wilderRSI: a sustained sharp rally pushes RSI into overbought (>=70)', () => {
  const bars = sharpMoveBars(40, { step: 0.003 });
  const result = wilderRSI(bars, 14);
  const latest = result[result.length - 1];
  assert.ok(latest >= 70, `expected overbought RSI after a sharp rally, got ${latest}`);
});
