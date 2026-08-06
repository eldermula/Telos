'use strict';

/**
 * 08_Bot_Architecture.md Section 2 — Initial Parameters & Constants.
 * Shared across Sections 4-8; centralized here so later sections don't
 * each redefine the same magic numbers.
 */
module.exports = {
  INITIAL_BALANCE: 10.0,
  LOCK_RATIO: 0.70,
  GROWTH_RATIO: 0.30,
  MACRO_MAX_DRAWDOWN_PCT: 0.45,
  MICRO_DAILY_DRAWDOWN_LIMIT: 0.15,
  EMERGENCY_FLOOR_RISK: 0.01,

  // Section 6.1 — Strategy B secondary halt floor: 60% down from peak.
  MACRO_HALT_DRAWDOWN_PCT: 0.60,
  // Section 6.1 — flat risk while in Strategy B. Numerically equal to
  // EMERGENCY_FLOOR_RISK today, but kept as a separate named constant:
  // that one is a universal floor, this one is Strategy B's fixed
  // override that ignores tier ceilings entirely.
  STRATEGY_B_FLAT_RISK: 0.01,
  // Section 6.1 — Strategy B only takes the highest-conviction setups.
  STRATEGY_B_MIN_CONFIDENCE: 0.90,

  // Section 7 — micro circuit breaker's own confidence floor. Distinct
  // from STRATEGY_B_MIN_CONFIDENCE above: different rule, different
  // number (Section 7 forces 1% risk below 80%; Section 6.1 only takes
  // trades at/above 90% once already in Strategy B).
  MICRO_MIN_CONFIDENCE: 0.80,
  // Section 7 — the "Two-Strike Rule": this many consecutive losses
  // forces the next trade's risk to EMERGENCY_FLOOR_RISK.
  MICRO_TWO_STRIKE_LOSS_COUNT: 2,

  // Section 8 / Module 6 (Learning Engine) — rolling window size for
  // live_win_probability.
  ROLLING_WINDOW_SIZE: 50,
  // Inferred, not explicitly stated in the spec: the "no trade history
  // yet" prior for live_win_probability. Chosen to match Section 9.1's
  // existing convention of using 0.5 for other neutral/no-data cases,
  // rather than a bare invented number.
  NEUTRAL_LIVE_WIN_PROBABILITY: 0.5,
};
