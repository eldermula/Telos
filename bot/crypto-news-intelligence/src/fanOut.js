'use strict';

const { instrumentsForEntity } = require('./watchlist');

/**
 * Fan one classification out to per-instrument relevance rows.
 * Same shape as forex fanOut — Selection can later consume either pipeline.
 */
function fanOutClassification(classification) {
  if (!classification || typeof classification !== 'object') {
    throw new TypeError('fanOutClassification requires a classification object');
  }
  const { entities = [], sentiment = 0, impact = 0 } = classification;
  const seen = new Set();
  const rows = [];
  for (const entity of entities) {
    for (const instrument of instrumentsForEntity(entity)) {
      if (seen.has(instrument)) continue;
      seen.add(instrument);
      rows.push({ instrument, sentiment, impact });
    }
  }
  return rows;
}

module.exports = { fanOutClassification };
