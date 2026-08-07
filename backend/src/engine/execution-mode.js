'use strict';

/**
 * Option 2 (real order placement) — Layer 3 of the gating design
 * (CHANGELOG.md): resolves whether a bot instance's *next* trade
 * decision should execute as 'paper' or 'real'. Pure function, no I/O
 * — it doesn't know or care how its three inputs were obtained (that's
 * Increment E's wiring concern), only what to do once given them.
 *
 * 'real' requires ALL THREE inputs to hold, with strict equality and
 * no coercion:
 *   - realTradingEnabled === true   (Layer 1 — the deploy-level kill switch)
 *   - accountType === 'real'        (live-read from broker_connections;
 *                                     'demo'/'contest'/anything else is not real)
 *   - liveTradingConfirmedAt is set (Layer 2 — Increment D's dedicated
 *                                     opt-in; presence-only check here,
 *                                     since D itself clears this on every
 *                                     Stop, so staleness is handled at
 *                                     the source, not re-derived here)
 *
 * Any missing, null, or wrongly-typed input resolves to 'paper' —
 * deliberately fails closed rather than throwing, since malformed
 * input must never become an opportunity to accidentally resolve
 * 'real'. This function never returns anything other than the two
 * literal strings 'paper' or 'real'.
 */
function resolveExecutionMode({ realTradingEnabled, accountType, liveTradingConfirmedAt }) {
  if (realTradingEnabled !== true) {
    return 'paper';
  }
  if (accountType !== 'real') {
    return 'paper';
  }
  // General falsy check, not just null/undefined: a real confirmation
  // timestamp (Date object or non-empty ISO string, as Postgres/pg
  // would actually hand back) is always truthy, so this costs nothing
  // against the real shape while also failing closed on any other
  // malformed value (0, '', false, NaN), not just the two specific
  // "absent" values — consistent with the rest of this function's
  // "ambiguous input never becomes an opportunity to resolve real" rule.
  if (!liveTradingConfirmedAt) {
    return 'paper';
  }
  return 'real';
}

module.exports = { resolveExecutionMode };
