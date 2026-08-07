'use strict';

const { instrumentsForCurrency } = require('./watchlist');

/**
 * `"XAU"` isn't a tradable currency pair leg the way USD/EUR/etc. are
 * — it's the classifier's shorthand for gold/safe-haven language that
 * maps straight to XAUUSD rather than through the currency->pairs
 * table the other entities use.
 */
function instrumentsForEntity(entity) {
  if (!entity) return [];
  const upper = String(entity).toUpperCase();
  if (upper === 'XAU') return ['XAUUSD'];
  return instrumentsForCurrency(upper);
}

/**
 * Section 9.0's "one LLM-parsed classification, fanned out
 * programmatically, no second LLM call." Every instrument this
 * classification's entities resolve to gets the *same*
 * sentiment/impact reading from this one headline; an instrument not
 * touched by any entity here simply doesn't hear from this headline
 * at all — aggregate.js treats that as "no contribution," not a
 * forced neutral score.
 */
function fanOutClassification(classification) {
  if (!classification || !Array.isArray(classification.entities)) {
    throw new TypeError('fanOutClassification requires a classification with an entities array');
  }
  const instruments = new Set();
  for (const entity of classification.entities) {
    for (const instrument of instrumentsForEntity(entity)) {
      instruments.add(instrument);
    }
  }
  return Array.from(instruments).map((instrument) => ({
    instrument,
    sentiment: classification.sentiment,
    impact: classification.impact,
  }));
}

module.exports = { fanOutClassification, instrumentsForEntity };
