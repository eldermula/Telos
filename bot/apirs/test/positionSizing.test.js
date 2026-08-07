'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeDrawdownPenalty,
  computeVolatilityPenalty,
  computeLossPenalty,
  computeRiskScore,
  computeFinalAppliedRisk,
} = require('../src/positionSizing');

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be close to ${expected}`
  );
}

// --- drawdown_penalty --------------------------------------------------

test('drawdown_penalty — 0 at peak (no drawdown)', () => {
  assertClose(computeDrawdownPenalty({ peakEquity: 100, activeTradingBalance: 100 }), 0);
});

test('drawdown_penalty — 0.5 at half the macro threshold (22.5% down from peak)', () => {
  assertClose(computeDrawdownPenalty({ peakEquity: 100, activeTradingBalance: 77.5 }), 0.5);
});

test('drawdown_penalty — reaches exactly 1.0 at the 45% macro breaker threshold', () => {
  assertClose(computeDrawdownPenalty({ peakEquity: 100, activeTradingBalance: 55 }), 1.0);
});

test('drawdown_penalty — clamped at 1.0 beyond the macro threshold', () => {
  assertClose(computeDrawdownPenalty({ peakEquity: 100, activeTradingBalance: 10 }), 1.0);
});

test('drawdown_penalty — rejects non-positive peakEquity', () => {
  assert.throws(() => computeDrawdownPenalty({ peakEquity: 0, activeTradingBalance: 10 }), RangeError);
});

// --- volatility_penalty -------------------------------------------------

test('volatility_penalty — 0 at normal volatility (current == average)', () => {
  assertClose(computeVolatilityPenalty({ currentATR: 10, rollingAvgATR: 10 }), 0);
});

test('volatility_penalty — 0.5 at 1.5x the rolling average', () => {
  assertClose(computeVolatilityPenalty({ currentATR: 15, rollingAvgATR: 10 }), 0.5);
});

test('volatility_penalty — 1.0 once current volatility is double the average', () => {
  assertClose(computeVolatilityPenalty({ currentATR: 20, rollingAvgATR: 10 }), 1.0);
});

test('volatility_penalty — clamped at 1.0 well beyond double', () => {
  assertClose(computeVolatilityPenalty({ currentATR: 50, rollingAvgATR: 10 }), 1.0);
});

test('volatility_penalty — floored at 0 when current volatility is below average', () => {
  assertClose(computeVolatilityPenalty({ currentATR: 5, rollingAvgATR: 10 }), 0);
});

test('volatility_penalty — rejects non-positive rollingAvgATR', () => {
  assert.throws(() => computeVolatilityPenalty({ currentATR: 5, rollingAvgATR: 0 }), RangeError);
});

// --- loss_penalty --------------------------------------------------------

test('loss_penalty — matches the spec\'s worked values exactly', () => {
  assertClose(computeLossPenalty({ consecutiveLosses: 0 }), 0);
  assertClose(computeLossPenalty({ consecutiveLosses: 1 }), 1 / 3);
  assertClose(computeLossPenalty({ consecutiveLosses: 2 }), 2 / 3);
  assertClose(computeLossPenalty({ consecutiveLosses: 3 }), 1.0);
});

test('loss_penalty — clamped at 1.0 beyond three losses', () => {
  assertClose(computeLossPenalty({ consecutiveLosses: 5 }), 1.0);
});

test('loss_penalty — rejects negative/non-integer consecutiveLosses', () => {
  assert.throws(() => computeLossPenalty({ consecutiveLosses: -1 }), RangeError);
  assert.throws(() => computeLossPenalty({ consecutiveLosses: 1.5 }), RangeError);
});

// --- risk_score (Rule 1) --------------------------------------------------

test('risk_score — sums the four positives, subtracts the three penalties', () => {
  const score = computeRiskScore({
    strategyConfidence: 0.8,
    liveWinProbability: 0.6,
    marketQuality: 0.7,
    trendQuality: 0.5,
    drawdownPenalty: 0.1,
    volatilityPenalty: 0.2,
    lossPenalty: 0.0,
  });
  assertClose(score, 0.8 + 0.6 + 0.7 + 0.5 - 0.1 - 0.2 - 0.0);
});

test('risk_score — can go negative when penalties dominate (not clamped itself)', () => {
  const score = computeRiskScore({
    strategyConfidence: 0,
    liveWinProbability: 0,
    marketQuality: 0,
    trendQuality: 0,
    drawdownPenalty: 1,
    volatilityPenalty: 1,
    lossPenalty: 1,
  });
  assertClose(score, -3);
});

test('risk_score — rejects out-of-range inputs', () => {
  assert.throws(
    () =>
      computeRiskScore({
        strategyConfidence: 1.5,
        liveWinProbability: 0.5,
        marketQuality: 0.5,
        trendQuality: 0.5,
        drawdownPenalty: 0,
        volatilityPenalty: 0,
        lossPenalty: 0,
      }),
    RangeError
  );
  assert.throws(
    () =>
      computeRiskScore({
        strategyConfidence: 0.5,
        liveWinProbability: -0.1,
        marketQuality: 0.5,
        trendQuality: 0.5,
        drawdownPenalty: 0,
        volatilityPenalty: 0,
        lossPenalty: 0,
      }),
    RangeError
  );
});

// --- computeFinalAppliedRisk (Rules 2-4, standard regime) -----------------

test('final risk — standard tier, mid-range score lands between floor and ceiling', () => {
  // Tier 3 (completedBlocks=3): baseRisk 0.04, ceiling 0.20
  const result = computeFinalAppliedRisk({
    balance: 1200,
    completedBlocks: 3,
    strategyConfidence: 0.7,
    liveWinProbability: 0.7,
    marketQuality: 0.6,
    trendQuality: 0.5,
    drawdownPenalty: 0,
    volatilityPenalty: 0,
    lossPenalty: 0,
  });
  assert.equal(result.tierParams.regime, 'standard');
  assert.equal(result.tierParams.tier, 3);
  assertClose(result.riskScore, 2.5);
  assertClose(result.calculatedRisk, 0.04 * 2.5); // 0.10
  assertClose(result.finalRisk, 0.10);
});

test('final risk — standard tier, best-case score clamped at the tier ceiling', () => {
  // Tier 0: baseRisk 0.02, ceiling 0.05. Best case risk_score = 4.0 -> calculated 0.08 > ceiling.
  const result = computeFinalAppliedRisk({
    balance: 60,
    completedBlocks: 0,
    strategyConfidence: 1,
    liveWinProbability: 1,
    marketQuality: 1,
    trendQuality: 1,
    drawdownPenalty: 0,
    volatilityPenalty: 0,
    lossPenalty: 0,
  });
  assertClose(result.riskScore, 4.0);
  assertClose(result.calculatedRisk, 0.08);
  assertClose(result.finalRisk, 0.05); // clamped to Tier 0's ceiling
});

test('final risk — standard tier, worst-case negative score clamped at the 1% floor', () => {
  const result = computeFinalAppliedRisk({
    balance: 1200,
    completedBlocks: 3,
    strategyConfidence: 0,
    liveWinProbability: 0,
    marketQuality: 0,
    trendQuality: 0,
    drawdownPenalty: 1,
    volatilityPenalty: 1,
    lossPenalty: 1,
  });
  assertClose(result.riskScore, -3);
  assert.ok(result.calculatedRisk < 0);
  assertClose(result.finalRisk, 0.01); // emergency floor
});

// --- computeFinalAppliedRisk (bootstrap regime) ---------------------------

test('final risk — bootstrap regime, best-case score clamped at the bootstrap risk ceiling', () => {
  // balance=20 -> bootstrap risk 0.5375, used as both baseRisk and maxRiskCeiling.
  const result = computeFinalAppliedRisk({
    balance: 20,
    strategyConfidence: 1,
    liveWinProbability: 1,
    marketQuality: 1,
    trendQuality: 1,
    drawdownPenalty: 0,
    volatilityPenalty: 0,
    lossPenalty: 0,
  });
  assert.equal(result.tierParams.regime, 'bootstrap');
  assertClose(result.tierParams.baseRisk, 0.5375);
  assertClose(result.calculatedRisk, 0.5375 * 4); // 2.15, well over the ceiling
  assertClose(result.finalRisk, 0.5375); // clamped down to the bootstrap ceiling
});

test('final risk — bootstrap regime, worst-case score clamped at the 1% floor', () => {
  const result = computeFinalAppliedRisk({
    balance: 8, // flat-capped bootstrap regime
    strategyConfidence: 0,
    liveWinProbability: 0,
    marketQuality: 0,
    trendQuality: 0,
    drawdownPenalty: 1,
    volatilityPenalty: 1,
    lossPenalty: 1,
  });
  assert.equal(result.tierParams.regime, 'bootstrap');
  assert.ok(result.calculatedRisk < 0);
  assertClose(result.finalRisk, 0.01);
});

// --- computeFinalAppliedRisk — Phase 7.8 tierRows injection ---------------

test('final risk — injected tierRows raises the effective ceiling for that tier', () => {
  const { TIER_MATRIX } = require('../src/tierMatrix');
  const overrideRows = TIER_MATRIX.map((row) =>
    row.tier === 0 ? { ...row, maxRiskCeiling: 0.5 } : row
  );
  const result = computeFinalAppliedRisk({
    balance: 60,
    completedBlocks: 0,
    tierRows: overrideRows,
    strategyConfidence: 1,
    liveWinProbability: 1,
    marketQuality: 1,
    trendQuality: 1,
    drawdownPenalty: 0,
    volatilityPenalty: 0,
    lossPenalty: 0,
  });
  // Same inputs as the "clamped at the tier ceiling" test above, but the
  // ceiling is now 0.5 instead of 0.05 — calculatedRisk (0.08) is under
  // the new ceiling, so it's no longer clamped.
  assertClose(result.calculatedRisk, 0.08);
  assertClose(result.finalRisk, 0.08);
  assertClose(result.tierParams.maxRiskCeiling, 0.5);
});

test('final risk — omitting tierRows is identical to the hardcoded matrix', () => {
  const withDefault = computeFinalAppliedRisk({
    balance: 1200,
    completedBlocks: 3,
    strategyConfidence: 0.7,
    liveWinProbability: 0.7,
    marketQuality: 0.6,
    trendQuality: 0.5,
    drawdownPenalty: 0,
    volatilityPenalty: 0,
    lossPenalty: 0,
  });
  const withExplicitUndefined = computeFinalAppliedRisk({
    balance: 1200,
    completedBlocks: 3,
    tierRows: undefined,
    strategyConfidence: 0.7,
    liveWinProbability: 0.7,
    marketQuality: 0.6,
    trendQuality: 0.5,
    drawdownPenalty: 0,
    volatilityPenalty: 0,
    lossPenalty: 0,
  });
  assert.deepEqual(withDefault, withExplicitUndefined);
});
