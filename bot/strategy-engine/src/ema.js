'use strict';

/**
 * Standard EMA. `values` must be in chronological order (oldest
 * first). Returns an array the same length as `values`, with `null`
 * for indices that don't have enough history yet (the first
 * `period - 1` entries) — same convention as Module 2's wilderATR.
 * Seeded with a simple average over the first `period` values, same
 * as the conventional EMA warm-up.
 */
function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    return (values || []).map(() => null);
  }

  const k = 2 / (period + 1);
  const result = new Array(values.length).fill(null);

  const seed = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  result[period - 1] = seed;

  for (let i = period; i < values.length; i += 1) {
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  }

  return result;
}

module.exports = { ema };
