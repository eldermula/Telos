'use strict';

/**
 * Option 2 (real order placement) — Layer 2 constants + the TTL check
 * that goes with them (CHANGELOG.md, Increment D).
 *
 * The confirmation phrase is NOT a secret (unlike the access gate's
 * passphrase) — it's shown verbatim in the confirm-live UI. The point
 * isn't recall, it's deliberate, careful typing as an act of assent,
 * same spirit as "type DELETE to confirm" patterns elsewhere. Compared
 * exact-match, case-sensitive, server-side only — never trust a
 * client-side match, same principle as the gate, different reason.
 */
const LIVE_TRADING_CONFIRMATION_PHRASE = 'I CONFIRM LIVE TRADING WITH REAL MONEY';

/**
 * Confirmation is a two-sided expiry: `trading-engine.js` clears it
 * to NULL on every Stop (per explicit "re-confirm after every Stop"
 * decision), and this TTL is the second side — defense-in-depth
 * against a confirmation that's never invalidated because Start (or
 * Stop) simply never gets called again after confirming. 120 minutes
 * is long enough for a human to confirm, finish connector/setup
 * checks, and press Start in the same sitting, short enough that a
 * confirmation typed today can't still be "armed" a day later with
 * nobody having looked at it since.
 */
const LIVE_TRADING_CONFIRMATION_TTL_MINUTES = 120;

/**
 * Lazy expiry, not active pruning — same pattern this codebase already
 * uses for JWTs and the access-gate cookie: nothing proactively nulls
 * the column out when the TTL lapses, every *reader* of
 * `live_trading_confirmed_at` must run it through this check first.
 * Fails closed on anything ambiguous: missing, unparseable, or a
 * timestamp in the future (clock skew / corrupt data) all resolve to
 * "not active", never to "confirmed forever".
 */
function isConfirmationActive(confirmedAt, now = new Date()) {
  if (!confirmedAt) {
    return false;
  }
  const confirmedDate = confirmedAt instanceof Date ? confirmedAt : new Date(confirmedAt);
  if (Number.isNaN(confirmedDate.getTime())) {
    return false;
  }
  const ageMs = now.getTime() - confirmedDate.getTime();
  return ageMs >= 0 && ageMs <= LIVE_TRADING_CONFIRMATION_TTL_MINUTES * 60 * 1000;
}

module.exports = {
  LIVE_TRADING_CONFIRMATION_PHRASE,
  LIVE_TRADING_CONFIRMATION_TTL_MINUTES,
  isConfirmationActive,
};
