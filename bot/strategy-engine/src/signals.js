'use strict';

const { ema } = require('./ema');
const { wilderRSI } = require('./rsi');

function lastTwo(series) {
  const n = series.length;
  return { now: series[n - 1], prev: series[n - 2] };
}

/**
 * MA Crossover strategy's signal (08_Bot_Architecture.md Section 13,
 * `candidate_strategies` seed "MA Crossover"): fires only on the bar
 * the fast EMA actually crosses the slow EMA, not on every bar it
 * happens to already be on one side — checking `prev` alongside `now`
 * is what makes this an edge-trigger rather than a level-check.
 */
function detectEmaCross(bars, { fastPeriod = 12, slowPeriod = 26 } = {}) {
  if (!Array.isArray(bars) || bars.length < slowPeriod + 1) return null;

  const closes = bars.map((bar) => bar.close);
  const { now: fastNow, prev: fastPrev } = lastTwo(ema(closes, fastPeriod));
  const { now: slowNow, prev: slowPrev } = lastTwo(ema(closes, slowPeriod));

  if ([fastNow, fastPrev, slowNow, slowPrev].some((v) => v === null || v === undefined)) {
    return null;
  }

  if (fastPrev <= slowPrev && fastNow > slowNow) return { direction: 'BUY' };
  if (fastPrev >= slowPrev && fastNow < slowNow) return { direction: 'SELL' };
  return null;
}

/**
 * Breakout strategy's signal (seed "Breakout"): the most recent bar's
 * close must clear the prior `lookbackBars` window's high/low — the
 * window deliberately excludes the candidate bar itself, or every bar
 * would trivially "break out" of a window that includes its own
 * extreme. Momentum confirmation = the breakout bar also closed in
 * the breakout direction (not just wicked through the level).
 */
function detectBreakout(bars, { lookbackBars = 20 } = {}) {
  if (!Array.isArray(bars) || bars.length < lookbackBars + 1) return null;

  const latest = bars[bars.length - 1];
  const window = bars.slice(bars.length - 1 - lookbackBars, bars.length - 1);
  const priorHigh = Math.max(...window.map((bar) => bar.high));
  const priorLow = Math.min(...window.map((bar) => bar.low));

  if (latest.close > priorHigh && latest.close > latest.open) {
    return { direction: 'BUY', level: priorHigh };
  }
  if (latest.close < priorLow && latest.close < latest.open) {
    return { direction: 'SELL', level: priorLow };
  }
  return null;
}

/**
 * RSI Mean Reversion strategy's signal (seed "RSI Mean Reversion"):
 * counter-trend entry once RSI crosses into oversold/overbought
 * territory.
 */
function detectRsiReversion(bars, { period = 14, oversold = 30, overbought = 70 } = {}) {
  const series = wilderRSI(bars, period);
  const latest = series[series.length - 1];
  if (latest === null || latest === undefined) return null;

  if (latest <= oversold) return { direction: 'BUY', rsi: latest };
  if (latest >= overbought) return { direction: 'SELL', rsi: latest };
  return null;
}

module.exports = { detectEmaCross, detectBreakout, detectRsiReversion };
