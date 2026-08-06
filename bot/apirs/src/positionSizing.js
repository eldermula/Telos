'use strict';

const { getTierRiskParameters } = require('./tierMatrix');
const { MACRO_MAX_DRAWDOWN_PCT, EMERGENCY_FLOOR_RISK } = require('./constants');

function assertUnitInterval(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be a finite number in [0, 1], got ${value}`);
  }
}

/**
 * 08_Bot_Architecture.md Section 4 — drawdown_penalty proposed formula.
 * Reaches 1.0 exactly as the account approaches the Section 6 macro
 * breaker's 45%-from-peak threshold. No lower floor in the spec (unlike
 * volatility_penalty below) — under correct sequencing peak_equity is a
 * running max, so the numerator shouldn't go negative in practice.
 */
function computeDrawdownPenalty({ peakEquity, activeTradingBalance, macroMaxDrawdownPct = MACRO_MAX_DRAWDOWN_PCT }) {
  if (!Number.isFinite(peakEquity) || peakEquity <= 0) {
    throw new RangeError(`peakEquity must be a positive finite number, got ${peakEquity}`);
  }
  if (!Number.isFinite(activeTradingBalance)) {
    throw new RangeError(`activeTradingBalance must be a finite number, got ${activeTradingBalance}`);
  }
  const raw = (peakEquity - activeTradingBalance) / peakEquity / macroMaxDrawdownPct;
  return Math.min(raw, 1.0);
}

/**
 * Section 4 — volatility_penalty proposed formula. 0 at normal volatility,
 * 1.0 once current ATR is roughly double the recent average. Explicitly
 * floored at 0 in the spec (current volatility below average is not a
 * bonus, just "no penalty").
 */
function computeVolatilityPenalty({ currentATR, rollingAvgATR }) {
  if (!Number.isFinite(rollingAvgATR) || rollingAvgATR <= 0) {
    throw new RangeError(`rollingAvgATR must be a positive finite number, got ${rollingAvgATR}`);
  }
  if (!Number.isFinite(currentATR) || currentATR < 0) {
    throw new RangeError(`currentATR must be a non-negative finite number, got ${currentATR}`);
  }
  const raw = currentATR / rollingAvgATR - 1;
  return Math.max(0, Math.min(1, raw));
}

/**
 * Section 4 — loss_penalty proposed formula. 0.33 after one loss, 0.67
 * after two (right before the Section 7 two-strike breaker forces 1%
 * risk anyway), 1.0 at three or more.
 */
function computeLossPenalty({ consecutiveLosses }) {
  if (!Number.isInteger(consecutiveLosses) || consecutiveLosses < 0) {
    throw new RangeError(`consecutiveLosses must be a non-negative integer, got ${consecutiveLosses}`);
  }
  return Math.min(consecutiveLosses / 3, 1.0);
}

/**
 * Section 4 Rule 1 — risk_score equation. All seven inputs are normalized
 * decimals in [0, 1]; validated here rather than trusting upstream modules
 * silently, consistent with APIRS's "deterministic gatekeeper" role (§9).
 */
function computeRiskScore({
  strategyConfidence,
  liveWinProbability,
  marketQuality,
  trendQuality,
  drawdownPenalty,
  volatilityPenalty,
  lossPenalty,
}) {
  assertUnitInterval(strategyConfidence, 'strategyConfidence');
  assertUnitInterval(liveWinProbability, 'liveWinProbability');
  assertUnitInterval(marketQuality, 'marketQuality');
  assertUnitInterval(trendQuality, 'trendQuality');
  assertUnitInterval(drawdownPenalty, 'drawdownPenalty');
  assertUnitInterval(volatilityPenalty, 'volatilityPenalty');
  assertUnitInterval(lossPenalty, 'lossPenalty');

  return (
    strategyConfidence +
    liveWinProbability +
    marketQuality +
    trendQuality -
    drawdownPenalty -
    volatilityPenalty -
    lossPenalty
  );
}

/**
 * Section 4 Rules 2-4 — combines the Section 3/3a tier lookup with the
 * risk_score equation to produce the final applied position risk.
 */
function computeFinalAppliedRisk({ balance, completedBlocks = 0, ...scoreInputs }) {
  const tierParams = getTierRiskParameters({ balance, completedBlocks });
  const riskScore = computeRiskScore(scoreInputs);
  const calculatedRisk = tierParams.baseRisk * riskScore;
  const finalRisk = Math.max(EMERGENCY_FLOOR_RISK, Math.min(calculatedRisk, tierParams.maxRiskCeiling));

  return {
    riskScore,
    calculatedRisk,
    finalRisk,
    tierParams,
  };
}

module.exports = {
  computeDrawdownPenalty,
  computeVolatilityPenalty,
  computeLossPenalty,
  computeRiskScore,
  computeFinalAppliedRisk,
};
