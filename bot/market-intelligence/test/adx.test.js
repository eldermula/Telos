'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { wilderADX } = require('../src/adx');
const { trendingBars, choppyBars, flatBars } = require('./fixtures');

test('wilderADX is all-null before 2*period bars exist', () => {
  const bars = trendingBars(27); // 2*14 = 28 needed
  const adx = wilderADX(bars, 14);
  assert.ok(adx.every((v) => v === null));
});

test('wilderADX produces a value once 2*period bars exist', () => {
  const bars = trendingBars(28);
  const adx = wilderADX(bars, 14);
  assert.notEqual(adx[27], null);
});

test('a clean, steady uptrend reads as a strong trend (high ADX)', () => {
  const bars = trendingBars(60);
  const adx = wilderADX(bars, 14);
  const last = adx[adx.length - 1];
  assert.ok(last > 40, `expected strong trend ADX > 40, got ${last}`);
});

test('a choppy, range-bound market reads as a weak trend (low ADX)', () => {
  const bars = choppyBars(60);
  const adx = wilderADX(bars, 14);
  const last = adx[adx.length - 1];
  assert.ok(last < 25, `expected weak trend ADX < 25, got ${last}`);
});

test('a strong uptrend reads a materially higher ADX than a choppy market', () => {
  const trendAdx = wilderADX(trendingBars(60), 14);
  const choppyAdx = wilderADX(choppyBars(60), 14);
  assert.ok(trendAdx[trendAdx.length - 1] > choppyAdx[choppyAdx.length - 1]);
});

test('a perfectly flat series does not produce NaN', () => {
  const bars = flatBars(40);
  const adx = wilderADX(bars, 14);
  const last = adx[adx.length - 1];
  assert.equal(Number.isNaN(last), false);
});
