'use strict';

/**
 * Wilder's RSI — the same smoothing convention as Module 2's
 * wilderATR (seeded with a simple average over the first `period`
 * changes, then smoothed). `bars` must be in chronological order
 * (oldest first) and need at least `period + 1` bars to produce a
 * first value (RSI needs a bar-over-bar change, so it's one bar
 * short of a raw indicator over the same period).
 */
function wilderRSI(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < period + 1) {
    return (bars || []).map(() => null);
  }

  const rsi = new Array(bars.length).fill(null);

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = bars[i].close - bars[i - 1].close;
    if (change > 0) gainSum += change;
    else lossSum += -change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < bars.length; i += 1) {
    const change = bars[i].close - bars[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return rsi;
}

module.exports = { wilderRSI };
