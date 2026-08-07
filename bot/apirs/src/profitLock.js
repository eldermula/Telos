'use strict';

const { getTierRow, STANDARD_MATRIX_FLOOR_BALANCE, TIER_MATRIX } = require('./tierMatrix');
const { LOCK_RATIO, GROWTH_RATIO } = require('./constants');

/**
 * 08_Bot_Architecture.md Section 5 — Profit Lock & Capital Reinvestment.
 *
 * Pure function: given the account's current state, returns whether a
 * milestone fired this evaluation and the resulting new state. The
 * caller (later, the Master Orchestrator) is responsible for persisting
 * the returned state back onto the account — this function has no side
 * effects and does not mutate its inputs.
 *
 * Settled — Section 3a interaction (Section 5 / Section 13): does not
 * apply while activeTradingBalance < $50. currentTierStepSize stays
 * meaningless for the entire bootstrap phase by design.
 *
 * `tierRows` (optional, Phase 7.9 — same contract `positionSizing.js`
 * got in 7.8) lets a caller supply a live-fetched `risk_tier_config`
 * matrix instead of this module's own hardcoded copy. Omitted, this
 * behaves exactly as before. Unlike position sizing's "frozen at
 * entry" concern, profit-lock is evaluated fresh at each trade close
 * (`resolveExit`), so there's no analogous mid-trade freeze here — a
 * `step_size` edit between a trade's open and close is simply picked
 * up at close, the same way a live tier-config read would be expected
 * to behave for a per-close calculation.
 */
function evaluateProfitLock({ activeTradingBalance, peakEquity, initialBalance, currentTier = 0, tierRows }) {
  if (!Number.isFinite(activeTradingBalance)) {
    throw new RangeError(`activeTradingBalance must be a finite number, got ${activeTradingBalance}`);
  }
  if (!Number.isFinite(peakEquity)) {
    throw new RangeError(`peakEquity must be a finite number, got ${peakEquity}`);
  }
  if (!Number.isFinite(initialBalance)) {
    throw new RangeError(`initialBalance must be a finite number, got ${initialBalance}`);
  }

  const noOp = {
    profitLockTriggered: false,
    completedBlocksThisEvaluation: 0,
    milestoneProfit: null,
    lockedProfitAmount: null,
    retainedGrowth: null,
    activeTradingBalance,
    peakEquity,
    currentTier,
  };

  // Rule (Settled, §13): profit-lock does not apply below $50.
  if (activeTradingBalance < STANDARD_MATRIX_FLOOR_BALANCE) {
    return noOp;
  }

  // Rule 1-2: net_profit against the account's fixed initial_balance; skip if <= 0.
  const netProfit = activeTradingBalance - initialBalance;
  if (netProfit <= 0) {
    return noOp;
  }

  // Rule 3: completed_blocks uses the CURRENT tier's step size (the tier
  // already achieved as of the last evaluation, not re-derived here).
  const currentTierStepSize = getTierRow(currentTier, tierRows).stepSize;
  const completedBlocks = Math.floor(netProfit / currentTierStepSize);
  if (completedBlocks === 0) {
    return noOp;
  }

  // Rule 5: milestone accounting.
  const milestoneProfit = completedBlocks * currentTierStepSize;
  const lockedProfitAmount = milestoneProfit * LOCK_RATIO;
  const retainedGrowth = milestoneProfit * GROWTH_RATIO;

  // Rule 6: Peak Reset Vector — reduce both tracked balances by the same
  // locked amount, in sync. No funds move; this is accounting only.
  const newActiveTradingBalance = activeTradingBalance - lockedProfitAmount;
  const newPeakEquity = peakEquity - lockedProfitAmount;

  // Tier advances by however many blocks completed this cycle, capped at
  // the ceiling tier — blocks beyond it don't need distinct tracking
  // since the ceiling tier's step size/risk parameters are fixed
  // regardless of how far past it the account goes (Section 3's "7+"
  // row). Capped against the same resolved rows getTierRow used above,
  // not always the hardcoded TIER_MATRIX, so an injected override's own
  // length (should it ever differ) is respected consistently.
  const resolvedRows = Array.isArray(tierRows) && tierRows.length > 0 ? tierRows : TIER_MATRIX;
  const newTier = Math.min(currentTier + completedBlocks, resolvedRows.length - 1);

  return {
    profitLockTriggered: true,
    completedBlocksThisEvaluation: completedBlocks,
    milestoneProfit,
    lockedProfitAmount,
    retainedGrowth,
    activeTradingBalance: newActiveTradingBalance,
    peakEquity: newPeakEquity,
    currentTier: newTier,
  };
}

module.exports = {
  evaluateProfitLock,
};
