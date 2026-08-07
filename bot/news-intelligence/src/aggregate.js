'use strict';

const { WATCHLIST } = require('./watchlist');
const { fanOutClassification } = require('./fanOut');

const CALENDAR_IMPACT_WEIGHT = { HIGH: 1.0, MEDIUM: 0.6, LOW: 0.3 };
// A full -1..+1 average sentiment maps to a full 0..1 swing around the
// 0.5 baseline (+1 avg sentiment -> market_quality 1.0; -1 -> 0.0).
const SENTIMENT_SCALE = 0.5;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Module 3's per-instrument output (08_Bot_Architecture.md Section 10
 * `news_intelligence` block), combining the structured calendar
 * (impact only, no direction) with headline classifications (impact +
 * sentiment), fanned out per instrument via fanOut.js.
 *
 * - `news_impact_score` (0-1) = MAX across every relevant calendar
 *   event's impact weight and every relevant headline's impact this
 *   cycle — deliberately MAX, not SUM, so one major event isn't
 *   diluted by several minor unrelated ones.
 * - `market_quality` (0-1) = 0.5 neutral baseline shifted by the
 *   *average* sentiment of this cycle's relevant headlines only —
 *   calendar impact tells you something's happening, not whether
 *   that's good or bad, so it doesn't shift this. **Explicitly
 *   clamped to [0, 1]** — a rescaled sentiment average could otherwise
 *   push the baseline out of range depending on how many/how strong
 *   the contributing headlines are.
 *
 * Returns every watchlist instrument, even ones with zero relevant
 * calendar events/headlines this cycle (those get the pure neutral
 * defaults: `market_quality: 0.5`, `news_impact_score: 0`).
 */
function aggregateNewsIntelligence({ calendarEvents = [], headlineClassifications = [] } = {}) {
  const calendarImpactByInstrument = new Map();
  for (const event of calendarEvents) {
    const weight = CALENDAR_IMPACT_WEIGHT[event.impact] || 0;
    for (const instrument of event.instruments || []) {
      calendarImpactByInstrument.set(
        instrument,
        Math.max(calendarImpactByInstrument.get(instrument) || 0, weight)
      );
    }
  }

  const headlineImpactByInstrument = new Map();
  const headlineSentimentsByInstrument = new Map();
  for (const classification of headlineClassifications) {
    for (const { instrument, sentiment, impact } of fanOutClassification(classification)) {
      headlineImpactByInstrument.set(instrument, Math.max(headlineImpactByInstrument.get(instrument) || 0, impact));
      const sentiments = headlineSentimentsByInstrument.get(instrument) || [];
      sentiments.push(sentiment);
      headlineSentimentsByInstrument.set(instrument, sentiments);
    }
  }

  const result = {};
  for (const instrument of WATCHLIST) {
    const calendarImpact = calendarImpactByInstrument.get(instrument) || 0;
    const headlineImpact = headlineImpactByInstrument.get(instrument) || 0;
    const news_impact_score = Math.max(calendarImpact, headlineImpact);

    const sentiments = headlineSentimentsByInstrument.get(instrument) || [];
    const avgSentiment = sentiments.length > 0 ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length : 0;
    const market_quality = clamp01(0.5 + avgSentiment * SENTIMENT_SCALE);

    result[instrument] = { market_quality, news_impact_score };
  }
  return result;
}

module.exports = { aggregateNewsIntelligence, CALENDAR_IMPACT_WEIGHT, SENTIMENT_SCALE };
