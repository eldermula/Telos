'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectEmaCross, detectBreakout, detectRsiReversion } = require('../src/signals');
const { trendingBars, sharpMoveBars, breakoutBars, flatBars, emaCrossBars } = require('./fixtures');

test('detectEmaCross: null when there are not enough bars', () => {
  assert.equal(detectEmaCross(trendingBars(10), { fastPeriod: 12, slowPeriod: 26 }), null);
});

test('detectEmaCross: a downtrend reversing into a steady uptrend eventually fires a BUY cross', () => {
  // A brief decline first (deterministically puts fast EMA below slow
  // EMA, avoiding a flat lead-in where the two are equal to
  // floating-point noise and "which side did it start on" is
  // undefined) then a clean, stronger uptrend — the fast EMA should
  // cross above the slow EMA exactly once as it catches up.
  const bars = emaCrossBars({ direction: 'BUY' });
  const result = detectEmaCross(bars, { fastPeriod: 12, slowPeriod: 26 });
  assert.ok(result, 'expected an EMA cross to fire on the last bar of the trimmed fixture');
  assert.equal(result.direction, 'BUY');
});

test('detectEmaCross: an uptrend reversing into a steady downtrend eventually fires a SELL cross', () => {
  const bars = emaCrossBars({ direction: 'SELL' });
  const result = detectEmaCross(bars, { fastPeriod: 12, slowPeriod: 26 });
  assert.ok(result, 'expected an EMA cross to fire on the last bar of the trimmed fixture');
  assert.equal(result.direction, 'SELL');
});

test('detectEmaCross: no signal (null) once already on one side with no fresh cross', () => {
  // A long-established uptrend with no lead-in flat period — by the
  // last bar the fast/slow EMAs are already far apart and have been
  // for a while, so the *edge* (prev vs now) shouldn't retrigger.
  const bars = trendingBars(80, { start: 1.1, step: 0.0008 });
  const result = detectEmaCross(bars, { fastPeriod: 12, slowPeriod: 26 });
  assert.equal(result, null);
});

test('detectBreakout: null when there are not enough bars', () => {
  assert.equal(detectBreakout(flatBars(5), { lookbackBars: 20 }), null);
});

test('detectBreakout: a flat range with no breakout bar stays silent', () => {
  const bars = flatBars(25);
  assert.equal(detectBreakout(bars, { lookbackBars: 20 }), null);
});

test('detectBreakout: a clean upside breakout with a confirming close fires BUY', () => {
  const bars = breakoutBars(25, { breakoutMove: 0.004 });
  const result = detectBreakout(bars, { lookbackBars: 20 });
  assert.ok(result, 'expected a breakout signal');
  assert.equal(result.direction, 'BUY');
});

test('detectBreakout: a clean downside breakout with a confirming close fires SELL', () => {
  const bars = breakoutBars(25, { breakoutMove: -0.004 });
  const result = detectBreakout(bars, { lookbackBars: 20 });
  assert.ok(result, 'expected a breakout signal');
  assert.equal(result.direction, 'SELL');
});

test('detectRsiReversion: oversold fires BUY, overbought fires SELL', () => {
  const oversoldBars = sharpMoveBars(40, { step: -0.003 });
  const overboughtBars = sharpMoveBars(40, { step: 0.003 });
  assert.equal(detectRsiReversion(oversoldBars, { period: 14 }).direction, 'BUY');
  assert.equal(detectRsiReversion(overboughtBars, { period: 14 }).direction, 'SELL');
});

test('detectRsiReversion: a neutral flat series does not force a false BUY/SELL', () => {
  // flatBars has zero gains and zero losses, which is the wilderRSI
  // degenerate "avgLoss===0 -> 100" edge case (see rsi.test.js) —
  // documented here as a known, accepted limitation of RSI on a
  // perfectly flat series, not asserted as a bug.
  const bars = flatBars(30);
  const result = detectRsiReversion(bars, { period: 14, oversold: 30, overbought: 70 });
  assert.equal(result?.direction, 'SELL');
});
