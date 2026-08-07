'use strict';

const { isConfirmationActive } = require('./live-trading-confirmation');

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
 *   - liveTradingConfirmedAt is an  (Layer 2 — Increment D's dedicated
 *     *active* confirmation           opt-in; checked through
 *                                     isConfirmationActive so both the
 *                                     Stop-side clear AND the 15-minute
 *                                     TTL are honored — a stale-but-
 *                                     uncleared timestamp must never
 *                                     resolve to 'real')
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
  // isConfirmationActive already fails closed on falsy / unparseable /
  // future / past-TTL values — using it here rather than a bare
  // truthiness check is what makes D's 15-minute TTL actually gate
  // real-mode resolution, not just the session-shape display.
  if (!isConfirmationActive(liveTradingConfirmedAt)) {
    return 'paper';
  }
  return 'real';
}

module.exports = { resolveExecutionMode };
