'use strict';

/**
 * Option 2 E.3 — last_validated_at must be recent before a real order.
 * Default window: 24 hours (approved). Fails closed on missing /
 * unparseable timestamps.
 */

function isConnectionFresh(lastValidatedAt, maxAgeHours, now = new Date()) {
  if (!lastValidatedAt) return false;
  if (!(maxAgeHours > 0)) return false;
  const validated =
    lastValidatedAt instanceof Date ? lastValidatedAt : new Date(lastValidatedAt);
  if (Number.isNaN(validated.getTime())) return false;
  const ageMs = now.getTime() - validated.getTime();
  if (ageMs < 0) return false; // future / clock skew → fail closed
  return ageMs <= maxAgeHours * 60 * 60 * 1000;
}

module.exports = { isConnectionFresh };
