'use strict';

const { instrumentsForCurrency } = require('./watchlist');

const VALID_IMPACTS = new Set(['LOW', 'MEDIUM', 'HIGH']);

/**
 * Forex Factory's public calendar JSON (08_Bot_Architecture.md Section
 * 9.3) returns `impact` as "Low"/"Medium"/"High" (case as-is), plus
 * non-numeric-impact rows like "Holiday" or "Non-Economic" that this
 * module treats as LOW rather than erroring — a holiday listing isn't
 * a malformed event, it's just not a real risk event.
 */
function normalizeImpact(rawImpact) {
  const upper = String(rawImpact || '').toUpperCase();
  return VALID_IMPACTS.has(upper) ? upper : 'LOW';
}

/**
 * Normalizes one raw Forex Factory calendar row into the shape the
 * rest of Module 3 works with, and resolves which watchlist
 * instruments (if any) it concerns. Country `"All"` (e.g. an OPEC
 * meeting) or a currency with no watchlist exposure both legitimately
 * resolve to an empty `instruments` array — not every event concerns
 * this bot's six instruments.
 */
function normalizeCalendarEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    throw new TypeError('normalizeCalendarEvent requires a raw event object');
  }
  const currency = typeof rawEvent.country === 'string' ? rawEvent.country.toUpperCase() : null;
  return {
    title: String(rawEvent.title || '').trim(),
    currency,
    impact: normalizeImpact(rawEvent.impact),
    date: rawEvent.date || null,
    instruments: instrumentsForCurrency(currency),
  };
}

function normalizeCalendarFeed(rawEvents) {
  if (!Array.isArray(rawEvents)) {
    throw new TypeError('normalizeCalendarFeed requires an array of raw events');
  }
  return rawEvents.map(normalizeCalendarEvent);
}

module.exports = { normalizeImpact, normalizeCalendarEvent, normalizeCalendarFeed };
