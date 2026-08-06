'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TIER_MATRIX,
  getTierRow,
  getStandardTier,
  bootstrapRiskPct,
  getTierRiskParameters,
} = require('../src/tierMatrix');

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be close to ${expected}`
  );
}

test('Section 3 — matrix values match the seeded migration exactly', () => {
  assert.deepEqual(
    TIER_MATRIX.map((r) => [r.tier, r.completedBlocksMin, r.stepSize, r.baseRisk, r.maxRiskCeiling]),
    [
      [0, 0, 150, 0.02, 0.05],
      [1, 1, 150, 0.02, 0.10],
      [2, 2, 150, 0.03, 0.15],
      [3, 3, 150, 0.04, 0.20],
      [4, 4, 300, 0.05, 0.25],
      [5, 5, 300, 0.06, 0.30],
      [6, 6, 500, 0.08, 0.35],
      [7, 7, 500, 0.10, 0.40],
    ]
  );
});

test('Section 3 — standard tier lookup by completed blocks', () => {
  assert.equal(getStandardTier(0).tier, 0);
  assert.equal(getStandardTier(1).tier, 1);
  assert.equal(getStandardTier(2).tier, 2);
  assert.equal(getStandardTier(3).tier, 3);
  assert.equal(getStandardTier(4).tier, 4);
  assert.equal(getStandardTier(5).tier, 5);
  assert.equal(getStandardTier(6).tier, 6);
  assert.equal(getStandardTier(7).tier, 7);
  // Tier 7 covers "7+" blocks — no tier 8 exists.
  assert.equal(getStandardTier(8).tier, 7);
  assert.equal(getStandardTier(1000).tier, 7);
});

test('Section 3 — rejects negative completed blocks', () => {
  assert.throws(() => getStandardTier(-1), RangeError);
});

test('getTierRow — direct validated lookup by tier number', () => {
  assert.equal(getTierRow(0).stepSize, 150);
  assert.equal(getTierRow(4).stepSize, 300);
  assert.equal(getTierRow(7).stepSize, 500);
  assert.throws(() => getTierRow(8), RangeError);
  assert.throws(() => getTierRow(-1), RangeError);
  assert.throws(() => getTierRow(1.5), RangeError);
});

test('Section 3a — worked reference table from the spec', () => {
  assertClose(bootstrapRiskPct(40), 0.2125);
  assertClose(bootstrapRiskPct(30), 0.375);
  assertClose(bootstrapRiskPct(20), 0.5375);
  assertClose(bootstrapRiskPct(10), 0.70);
});

test('Section 3a — flat 70% cap at and below $10, not just exactly at $10', () => {
  assertClose(bootstrapRiskPct(10), 0.70);
  assertClose(bootstrapRiskPct(5), 0.70);
  assertClose(bootstrapRiskPct(1), 0.70);
  assertClose(bootstrapRiskPct(0), 0.70);
  assertClose(bootstrapRiskPct(-5), 0.70); // blown-past-zero edge case; still flat-capped, not extrapolated
});

test('Section 3a — approaches 5% as balance approaches $50 from below (no discontinuity)', () => {
  assertClose(bootstrapRiskPct(49.999999), 0.05, 1e-6);
});

test('Section 3a — throws rather than extrapolating for balance >= $50', () => {
  assert.throws(() => bootstrapRiskPct(50), RangeError);
  assert.throws(() => bootstrapRiskPct(75), RangeError);
});

test('getTierRiskParameters — routes to bootstrap regime below $50', () => {
  const params = getTierRiskParameters({ balance: 20, completedBlocks: 0 });
  assert.equal(params.regime, 'bootstrap');
  assert.equal(params.tier, null);
  assert.equal(params.stepSize, null);
  assertClose(params.baseRisk, 0.5375);
  // In bootstrap mode there is only one risk number — it serves as both
  // base risk and ceiling (Section 4 reads it this way).
  assertClose(params.maxRiskCeiling, 0.5375);
});

test('getTierRiskParameters — bootstrap flat cap ignores completedBlocks entirely', () => {
  const a = getTierRiskParameters({ balance: 8, completedBlocks: 0 });
  const b = getTierRiskParameters({ balance: 8, completedBlocks: 6 });
  assertClose(a.baseRisk, 0.70);
  assertClose(b.baseRisk, 0.70);
});

test('getTierRiskParameters — $50 is the inclusive handoff to the standard matrix', () => {
  const atFifty = getTierRiskParameters({ balance: 50, completedBlocks: 0 });
  assert.equal(atFifty.regime, 'standard');
  assert.equal(atFifty.tier, 0);
  assertClose(atFifty.maxRiskCeiling, 0.05);

  const justBelow = getTierRiskParameters({ balance: 49.999999, completedBlocks: 0 });
  assert.equal(justBelow.regime, 'bootstrap');
  // Continuity check: the bootstrap ceiling approaching $50 matches Tier 0's
  // Max AI Risk Ceiling exactly, so there's no jump at the handoff.
  assertClose(justBelow.maxRiskCeiling, atFifty.maxRiskCeiling, 1e-6);
});

test('getTierRiskParameters — standard regime at higher tiers/balances', () => {
  const params = getTierRiskParameters({ balance: 1200, completedBlocks: 3 });
  assert.equal(params.regime, 'standard');
  assert.equal(params.tier, 3);
  assertClose(params.baseRisk, 0.04);
  assertClose(params.maxRiskCeiling, 0.20);
  assert.equal(params.stepSize, 150);
});

test('getTierRiskParameters — rejects non-finite balance', () => {
  assert.throws(() => getTierRiskParameters({ balance: NaN, completedBlocks: 0 }), RangeError);
});
