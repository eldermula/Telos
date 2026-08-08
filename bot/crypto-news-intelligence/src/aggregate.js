'use strict';

const { CRYPTO_WATCHLIST } = require('./watchlist');
const { fanOutClassification } = require('./fanOut');

// No economic calendar for crypto (docs/11 §3). Headlines only.
const SENTIMENT_SCALE = 0.5;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Per-instrument crypto news output — same consumer contract as forex
 * Module 3: { market_quality, news_impact_score } for every watchlist
 * instrument. No calendar contribution.
 */
function aggregateCryptoNewsIntelligence({ headlineClassifications = [] } = {}) {
  const headlineImpactByInstrument = new Map();
  const headlineSentimentsByInstrument = new Map();

  for (const classification of headlineClassifications) {
    for (const { instrument, sentiment, impact } of fanOutClassification(classification)) {
      headlineImpactByInstrument.set(
        instrument,
        Math.max(headlineImpactByInstrument.get(instrument) || 0, impact)
      );
      const sentiments = headlineSentimentsByInstrument.get(instrument) || [];
      sentiments.push(sentiment);
      headlineSentimentsByInstrument.set(instrument, sentiments);
    }
  }

  const result = {};
  for (const instrument of CRYPTO_WATCHLIST) {
    const news_impact_score = headlineImpactByInstrument.get(instrument) || 0;
    const sentiments = headlineSentimentsByInstrument.get(instrument) || [];
    const avgSentiment =
      sentiments.length > 0 ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length : 0;
    const market_quality = clamp01(0.5 + avgSentiment * SENTIMENT_SCALE);
    result[instrument] = { market_quality, news_impact_score };
  }
  return result;
}

module.exports = { aggregateCryptoNewsIntelligence, SENTIMENT_SCALE };
