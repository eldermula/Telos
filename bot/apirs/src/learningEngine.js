'use strict';

const { ROLLING_WINDOW_SIZE, NEUTRAL_LIVE_WIN_PROBABILITY } = require('./constants');

/**
 * 08_Bot_Architecture.md Section 8 (Phase 7 — Closed-Loop Self Learning)
 * + Section 9 Module 6 (Learning Engine).
 *
 * Structure only, per this revision's scope — no AI calls. This module's
 * job is narrower than Section 8's one-line summary suggests: of the four
 * "performance vectors" it names (strategy_confidence, live_win_probability,
 * market_quality, trend_quality), only live_win_probability is something
 * the Learning Engine itself computes (Module 6, Section 9). The other
 * three are Modules 2-4's outputs (Market Intelligence / News AI /
 * Strategy Engine) — not built until Phase 6 — so this module does not
 * fabricate placeholder logic for them; callers (for now, the
 * paper-trading harness) continue supplying those directly, per the
 * Roadmap's "stubbed/manual" scoping for this phase.
 *
 * Module 6's "feeds adjustments to drawdown_penalty/loss_penalty back
 * into Module 5" means supplying the raw trade-history-derived state
 * (consecutive_losses) those already-built Section 4 formulas consume —
 * not recomputing the formulas themselves. drawdown_penalty needs no
 * learning input at all; it's already a pure function of peak/balance.
 *
 * Every function here is a pure reducer over an explicit trade-history
 * array — no module-level state, no side effects — consistent with every
 * other APIRS module. The caller owns persistence.
 */

function assertHistory(history) {
  if (!Array.isArray(history)) {
    throw new RangeError(`tradeHistory must be an array, got ${typeof history}`);
  }
}

/**
 * Records one closed trade's outcome, trimmed to the trailing
 * ROLLING_WINDOW_SIZE entries (Module 6's rolling 50-trade window).
 * `conditions` is an optional opaque snapshot of the environment dict
 * present when the trade opened (Module 6: "logs each trade's outcome
 * against the conditions present when it opened") — stored verbatim for
 * future decision-log wiring (FR-BOT-6, Phase 4), not interpreted here.
 */
function recordTradeOutcome(history, { wasWin, pnlAmount, conditions = null } = {}) {
  assertHistory(history);
  if (typeof wasWin !== 'boolean') {
    throw new RangeError(`wasWin must be a boolean, got ${wasWin}`);
  }
  if (!Number.isFinite(pnlAmount)) {
    throw new RangeError(`pnlAmount must be a finite number, got ${pnlAmount}`);
  }

  const updated = [...history, { wasWin, pnlAmount, conditions }];
  return updated.length > ROLLING_WINDOW_SIZE
    ? updated.slice(updated.length - ROLLING_WINDOW_SIZE)
    : updated;
}

/**
 * Module 6 — live_win_probability over the rolling window. Returns the
 * neutral default (see constants.js note) when there's no history yet,
 * rather than dividing by zero or asserting a false 0%/100% at the start
 * of an account's life.
 */
function computeLiveWinProbability(history) {
  assertHistory(history);
  if (history.length === 0) {
    return NEUTRAL_LIVE_WIN_PROBABILITY;
  }
  const wins = history.filter((trade) => trade.wasWin).length;
  return wins / history.length;
}

/**
 * Consecutive losses since the most recent win (or since the start of
 * history, if every recorded trade so far has been a loss). Feeds
 * Section 4's loss_penalty and Section 7's Two-Strike Rule directly —
 * both already accept this as a plain input, so no changes were needed
 * to either of those already-tested modules.
 */
function computeConsecutiveLosses(history) {
  assertHistory(history);
  let count = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].wasWin) break;
    count += 1;
  }
  return count;
}

module.exports = {
  recordTradeOutcome,
  computeLiveWinProbability,
  computeConsecutiveLosses,
};
