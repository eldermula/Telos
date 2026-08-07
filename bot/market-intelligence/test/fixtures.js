'use strict';

/**
 * Deterministic synthetic OHLC generators for indicator tests — no
 * randomness, so failures are reproducible and hand-checkable.
 */

function makeBar(close, prevClose, halfRange) {
  const open = prevClose === null ? close : prevClose;
  const high = Math.max(open, close) + halfRange;
  const low = Math.min(open, close) - halfRange;
  return { open, high, low, close };
}

// Steady uptrend, small consistent range each bar — should read as a
// strong, clean trend (high ADX).
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

// Oscillates around a flat base with no net direction over the window
// — should read as a weak/no trend (low ADX).
function choppyBars(count, { base = 1.1, amplitude = 0.001, period = 6, halfRange = 0.0001 } = {}) {
  const bars = [];
  let prevClose = null;
  for (let i = 0; i < count; i += 1) {
    const phase = (i % period) / period;
    const close = base + amplitude * Math.sin(phase * 2 * Math.PI);
    bars.push(makeBar(close, prevClose, halfRange));
    prevClose = close;
  }
  return bars;
}

// Calm, near-constant range for most of the window, then a burst of
// much wider bars at the end — currentATR should spike above the
// rolling average.
function volatilitySpikeBars(count, { spikeLength = 8, calmHalfRange = 0.0001, spikeHalfRange = 0.0015 } = {}) {
  const bars = [];
  let prevClose = 1.1;
  for (let i = 0; i < count; i += 1) {
    const inSpike = i >= count - spikeLength;
    const halfRange = inSpike ? spikeHalfRange : calmHalfRange;
    const drift = inSpike ? (i % 2 === 0 ? 1 : -1) * spikeHalfRange * 0.5 : 0;
    const close = 1.1 + drift;
    bars.push(makeBar(close, prevClose, halfRange));
    prevClose = close;
  }
  return bars;
}

// Perfectly flat — every field identical. Degenerate case: TR/ATR are
// all zero, so the volatility ratio must not divide by zero.
function flatBars(count, { price = 1.1 } = {}) {
  const bars = [];
  for (let i = 0; i < count; i += 1) {
    bars.push({ open: price, high: price, low: price, close: price });
  }
  return bars;
}

module.exports = { trendingBars, choppyBars, volatilitySpikeBars, flatBars };
