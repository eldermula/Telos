/**
 * Must match `LIVE_TRADING_CONFIRMATION_PHRASE` in
 * `backend/src/engine/live-trading-confirmation.js` exactly —
 * case-sensitive, character-for-character. Not a secret (shown
 * verbatim in the Confirm Live modal); the point is deliberate
 * typing as an act of assent, not recall. Keep both copies in sync
 * when changing the phrase.
 */
export const LIVE_TRADING_CONFIRMATION_PHRASE =
  'I CONFIRM LIVE TRADING WITH REAL MONEY';

/**
 * Must match `LIVE_TRADING_CONFIRMATION_TTL_MINUTES` in
 * `backend/src/engine/live-trading-confirmation.js`. Shared Layer 2
 * TTL for forex M15, M5 real-dispatch, and synthetics.
 */
export const LIVE_TRADING_CONFIRMATION_TTL_MINUTES = 120;
