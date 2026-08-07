'use strict';

function trueRange(bar, prevClose) {
  if (prevClose === null || prevClose === undefined) {
    return bar.high - bar.low;
  }
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - prevClose),
    Math.abs(bar.low - prevClose)
  );
}

/**
 * Wilder's ATR (08_Bot_Architecture.md Section 4/9.0, Module 2's
 * market_volatility/volatility_penalty input). `bars` must be in
 * chronological order (oldest first). Returns an array the same
 * length as `bars`, with `null` for indices that don't have enough
 * history yet (the first `period - 1` entries).
 */
function wilderATR(bars, period = 14) {
  if (!Array.isArray(bars)) return [];
  if (bars.length < period) return bars.map(() => null);

  const trueRanges = bars.map((bar, i) => trueRange(bar, i > 0 ? bars[i - 1].close : null));
  const atr = new Array(bars.length).fill(null);

  const seedSum = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0);
  atr[period - 1] = seedSum / period;

  for (let i = period; i < bars.length; i += 1) {
    atr[i] = (atr[i - 1] * (period - 1) + trueRanges[i]) / period;
  }

  return atr;
}

module.exports = { trueRange, wilderATR };
