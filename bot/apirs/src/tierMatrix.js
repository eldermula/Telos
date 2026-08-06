'use strict';

/**
 * 08_Bot_Architecture.md Section 3 — Standard Tier 0-7 Matrix
 * Applies once active_trading_balance >= $50.
 *
 * This is a hardcoded mirror of database/migrations/002_seed_risk_tier_config.sql.
 * That migration is the eventual source of truth once the bot is wired to
 * Postgres (Phase 4+). Until then, this array is APIRS's own authoritative
 * copy for its deterministic logic and paper-trading harness. If the seed
 * migration values ever change, this array must be updated to match.
 */
const TIER_MATRIX = [
  { tier: 0, completedBlocksMin: 0, stepSize: 150, baseRisk: 0.02, maxRiskCeiling: 0.05 },
  { tier: 1, completedBlocksMin: 1, stepSize: 150, baseRisk: 0.02, maxRiskCeiling: 0.10 },
  { tier: 2, completedBlocksMin: 2, stepSize: 150, baseRisk: 0.03, maxRiskCeiling: 0.15 },
  { tier: 3, completedBlocksMin: 3, stepSize: 150, baseRisk: 0.04, maxRiskCeiling: 0.20 },
  { tier: 4, completedBlocksMin: 4, stepSize: 300, baseRisk: 0.05, maxRiskCeiling: 0.25 },
  { tier: 5, completedBlocksMin: 5, stepSize: 300, baseRisk: 0.06, maxRiskCeiling: 0.30 },
  { tier: 6, completedBlocksMin: 6, stepSize: 500, baseRisk: 0.08, maxRiskCeiling: 0.35 },
  { tier: 7, completedBlocksMin: 7, stepSize: 500, baseRisk: 0.10, maxRiskCeiling: 0.40 },
];

/** Section 3 / Section 3a handoff point — inclusive to the standard matrix. */
const STANDARD_MATRIX_FLOOR_BALANCE = 50;

/**
 * 08_Bot_Architecture.md Section 3a — Sub-$50 Bootstrap Risk Curve
 * Two anchor points for the inverse-linear scale:
 *   - $50 balance -> 5% risk (matches Tier 0's Max AI Risk Ceiling exactly,
 *     so there's no discontinuity at the handoff to the standard matrix)
 *   - $10 balance -> 70% risk, flat-capped for any balance <= $10
 */
const BOOTSTRAP_UPPER_BALANCE = 50;
const BOOTSTRAP_LOWER_BALANCE = 10;
const BOOTSTRAP_UPPER_RISK = 0.05;
const BOOTSTRAP_LOWER_RISK = 0.70;

/**
 * Direct, validated lookup of a tier row by tier number (0-7). Used by
 * Section 5, which already knows the account's current tier (persisted
 * state) and needs that tier's step size, as opposed to getStandardTier
 * below which derives the tier from a completed-blocks count.
 */
function getTierRow(tier) {
  if (!Number.isInteger(tier) || tier < 0 || tier >= TIER_MATRIX.length) {
    throw new RangeError(`tier must be an integer in [0, ${TIER_MATRIX.length - 1}], got ${tier}`);
  }
  return TIER_MATRIX[tier];
}

/**
 * Section 3 — resolves the standard tier row from total completed profit
 * blocks. Tier 7 covers "7+" blocks, i.e. it's the ceiling tier.
 */
function getStandardTier(completedBlocks) {
  if (!Number.isFinite(completedBlocks) || completedBlocks < 0) {
    throw new RangeError(`completedBlocks must be a non-negative number, got ${completedBlocks}`);
  }
  const tierIndex = Math.min(Math.floor(completedBlocks), TIER_MATRIX.length - 1);
  return TIER_MATRIX[tierIndex];
}

/**
 * Section 3a — inverse-linear bootstrap risk curve. Only valid for
 * balance < $50 (callers should route >= $50 to getStandardTier instead;
 * this throws rather than silently extrapolating past its domain).
 */
function bootstrapRiskPct(balance) {
  if (!Number.isFinite(balance)) {
    throw new RangeError(`balance must be a finite number, got ${balance}`);
  }
  if (balance >= STANDARD_MATRIX_FLOOR_BALANCE) {
    throw new RangeError(
      `bootstrapRiskPct only applies below $${STANDARD_MATRIX_FLOOR_BALANCE}; got balance=${balance}`
    );
  }
  if (balance <= BOOTSTRAP_LOWER_BALANCE) {
    return BOOTSTRAP_LOWER_RISK;
  }
  const span = BOOTSTRAP_UPPER_BALANCE - BOOTSTRAP_LOWER_BALANCE; // 40
  const riskSpan = BOOTSTRAP_LOWER_RISK - BOOTSTRAP_UPPER_RISK; // 0.65
  return BOOTSTRAP_UPPER_RISK + ((BOOTSTRAP_UPPER_BALANCE - balance) / span) * riskSpan;
}

/**
 * Single entry point Sections 4-8 will call: resolves which regime a given
 * balance/completed-blocks pair falls into and returns a normalized shape.
 * In the bootstrap regime there is only one risk number, so it serves as
 * both baseRisk and maxRiskCeiling (Section 4 Rule 2/3 reads it this way).
 */
function getTierRiskParameters({ balance, completedBlocks = 0 }) {
  if (!Number.isFinite(balance)) {
    throw new RangeError(`balance must be a finite number, got ${balance}`);
  }

  if (balance >= STANDARD_MATRIX_FLOOR_BALANCE) {
    const row = getStandardTier(completedBlocks);
    return {
      regime: 'standard',
      tier: row.tier,
      baseRisk: row.baseRisk,
      maxRiskCeiling: row.maxRiskCeiling,
      stepSize: row.stepSize,
    };
  }

  const riskPct = bootstrapRiskPct(balance);
  return {
    regime: 'bootstrap',
    tier: null,
    baseRisk: riskPct,
    maxRiskCeiling: riskPct,
    stepSize: null,
  };
}

module.exports = {
  TIER_MATRIX,
  STANDARD_MATRIX_FLOOR_BALANCE,
  BOOTSTRAP_UPPER_BALANCE,
  BOOTSTRAP_LOWER_BALANCE,
  BOOTSTRAP_UPPER_RISK,
  BOOTSTRAP_LOWER_RISK,
  getTierRow,
  getStandardTier,
  bootstrapRiskPct,
  getTierRiskParameters,
};
