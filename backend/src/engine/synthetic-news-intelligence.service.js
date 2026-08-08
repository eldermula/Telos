'use strict';

/**
 * Synthetics "news" — intentional non-participation (docs/11 §3).
 * Synthetic indices are designed to be immune to real-world events;
 * market_quality is fixed neutral, never computed from RSS/calendar/LLM.
 */

const path = require('path');
const { SYNTHETIC_WATCHLIST } = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  'bot',
  'synthetic-market-intelligence',
  'src',
  'watchlist.js'
));

const NEUTRAL = Object.freeze({
  market_quality: 0.5,
  news_impact_score: 0,
});

/**
 * Per-instrument neutral map — same shape crypto news returns so
 * selection/runtime can share the consumption contract.
 */
async function getSyntheticNewsIntelligence() {
  const out = {
    stale: false,
    reason: 'synthetics_news_not_applicable',
    asset_class: 'synthetic',
    sources: { calendar: false, headlines: false, intentional_exclusion: true },
    new_headline_count: 0,
  };
  for (const symbol of SYNTHETIC_WATCHLIST) {
    out[symbol] = { ...NEUTRAL };
  }
  return out;
}

module.exports = {
  getSyntheticNewsIntelligence,
  SYNTHETIC_WATCHLIST,
  NEUTRAL,
};
