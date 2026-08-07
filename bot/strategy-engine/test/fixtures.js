'use strict';

/**
 * Deterministic synthetic OHLC generators for indicator/signal tests
 * — no randomness, so failures are reproducible and hand-checkable.
 * Mirrors bot/market-intelligence/test/fixtures.js's conventions.
 */

function makeBar(close, prevClose, halfRange) {
  const open = prevClose === null ? close : prevClose;
  const high = Math.max(open, close) + halfRange;
  const low = Math.min(open, close) - halfRange;
  return { open, high, low, close };
}

// Steady uptrend/downtrend — fast EMA should cross above/below the
// slow EMA partway through as the average catches up to the drift.
function trendingBars(count, { start = 1.1, step = 0.0006, halfRange = 0.0001 } = {}) {
  const bars = [];
  let prevClose = null;
  for (let i = 0; i < count; i += 1) {
    const close = start + step * i;
    bars.push(makeBar(close, prevClose, halfRange));
    prevClose = close;
  }
  return bars;
}

// Flat, then a sharp multi-bar move in one direction — RSI should
// swing into oversold/overbought territory.
function sharpMoveBars(count, { base = 1.1, flatLength = 20, step = -0.002, halfRange = 0.0001 } = {}) {
  const bars = [];
  let prevClose = null;
  for (let i = 0; i < count; i += 1) {
    const inMove = i >= flatLength;
    const close = inMove ? base + step * (i - flatLength + 1) : base;
    bars.push(makeBar(close, prevClose, halfRange));
    prevClose = close;
  }
  return bars;
}

// Flat consolidation range, then one bar that closes cleanly above
// the range with a same-direction open->close move (breakout + a
// same-direction close as momentum confirmation).
function breakoutBars(count, { base = 1.1, rangeHalf = 0.001, breakoutMove = 0.004, halfRange = 0.0001 } = {}) {
  const bars = [];
  let prevClose = base;
  for (let i = 0; i < count - 1; i += 1) {
    const phase = (i % 4) / 4;
    const close = base + rangeHalf * Math.sin(phase * 2 * Math.PI);
    bars.push(makeBar(close, prevClose, halfRange));
    prevClose = close;
  }
  // Final bar: opens at the last range close, closes well above it.
  const breakoutClose = prevClose + breakoutMove;
  bars.push({ open: prevClose, high: breakoutClose + halfRange, low: prevClose - halfRange, close: breakoutClose });
  return bars;
}

// Oscillates around a flat base with no net direction — used to
// confirm a strategy stays silent (WAIT) when nothing has happened.
function flatBars(count, { price = 1.1, halfRange = 0.0001 } = {}) {
  const bars = [];
  for (let i = 0; i < count; i += 1) {
    bars.push({ open: price, high: price + halfRange, low: price - halfRange, close: price });
  }
  return bars;
}

// Trims a bars array down to the first point an EMA cross fires,
// so callers testing "does the *current* bar have a signal" (rather
// than "does a cross fire *somewhere* in this series") get a
// deterministic array that ends exactly on the crossing bar.
function emaCrossBars({ fastPeriod = 12, slowPeriod = 26, direction = 'BUY' } = {}) {
  // eslint-disable-next-line global-require -- avoids a require cycle at module load time
  const { detectEmaCross } = require('../src/signals');
  const bars =
    direction === 'BUY'
      ? [...trendingBars(30, { start: 1.15, step: -0.0006 }), ...trendingBars(40, { start: 1.132, step: 0.0012 })]
      : [...trendingBars(30, { start: 1.05, step: 0.0006 }), ...trendingBars(40, { start: 1.068, step: -0.0012 })];

  for (let i = slowPeriod + 1; i <= bars.length; i += 1) {
    const slice = bars.slice(0, i);
    const result = detectEmaCross(slice, { fastPeriod, slowPeriod });
    if (result && result.direction === direction) return slice;
  }
  throw new Error(`emaCrossBars: no ${direction} cross found in the generated fixture — adjust its parameters`);
}

module.exports = { trendingBars, sharpMoveBars, breakoutBars, flatBars, emaCrossBars };
