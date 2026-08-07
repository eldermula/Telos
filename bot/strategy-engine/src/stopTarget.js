'use strict';

const DEFAULT_ATR_STOP_MULTIPLE = 1.5;
const DEFAULT_REWARD_RISK_RATIO = 2;

/**
 * Converts a strategy's stop/target rule + Module 2's ATR into actual
 * price levels for a live entry. ATR-based stop distance keeps risk
 * proportional to each instrument's own volatility rather than a flat
 * point distance — this is price-level math, so it works identically
 * for a 5-digit pair, a 3-digit JPY pair, or gold without any
 * instrument-specific branching (08_Bot_Architecture.md Section 9,
 * Module 7 note — lot-sizing is the part that needs per-instrument
 * specs, not this).
 */
function computeStopTarget({ entryPrice, direction, currentATR, stopRule, targetRule }) {
  const stopDistance = currentATR * (stopRule?.multiple ?? DEFAULT_ATR_STOP_MULTIPLE);
  const sign = direction === 'BUY' ? 1 : -1;
  const rewardRiskRatio = targetRule?.ratio ?? DEFAULT_REWARD_RISK_RATIO;

  return {
    stopPrice: entryPrice - sign * stopDistance,
    targetPrice: entryPrice + sign * stopDistance * rewardRiskRatio,
    stopDistance,
  };
}

module.exports = { computeStopTarget, DEFAULT_ATR_STOP_MULTIPLE, DEFAULT_REWARD_RISK_RATIO };
