'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { aggregateNewsIntelligence } = require('../src/aggregate');
const { WATCHLIST } = require('../src/watchlist');

test('with no calendar events and no headlines, every instrument is pure neutral', () => {
  const result = aggregateNewsIntelligence({});
  for (const instrument of WATCHLIST) {
    assert.equal(result[instrument].market_quality, 0.5, `${instrument} market_quality`);
    assert.equal(result[instrument].news_impact_score, 0, `${instrument} news_impact_score`);
  }
});

test('returns every watchlist instrument, not just the ones touched this cycle', () => {
  const result = aggregateNewsIntelligence({
    calendarEvents: [{ title: 'BoJ Rate Decision', currency: 'JPY', impact: 'HIGH', instruments: ['USDJPY'] }],
  });
  assert.deepEqual(Object.keys(result).sort(), [...WATCHLIST].sort());
  assert.equal(result.EURUSD.news_impact_score, 0, 'untouched instrument should stay neutral');
});

test('a HIGH-impact calendar event sets news_impact_score to 1.0 for its instruments, without touching market_quality', () => {
  const result = aggregateNewsIntelligence({
    calendarEvents: [{ title: 'ISM PMI', currency: 'USD', impact: 'HIGH', instruments: ['EURUSD', 'GBPUSD'] }],
  });
  assert.equal(result.EURUSD.news_impact_score, 1.0);
  assert.equal(result.GBPUSD.news_impact_score, 1.0);
  assert.equal(result.EURUSD.market_quality, 0.5, 'calendar impact alone must not shift market_quality');
});

test('news_impact_score takes the MAX across relevant events, not the sum', () => {
  const result = aggregateNewsIntelligence({
    calendarEvents: [
      { title: 'A', currency: 'USD', impact: 'MEDIUM', instruments: ['EURUSD'] },
      { title: 'B', currency: 'USD', impact: 'LOW', instruments: ['EURUSD'] },
    ],
  });
  // MEDIUM weight is 0.6 — if this were summed with LOW's 0.3 it'd be 0.9; MAX keeps it at 0.6.
  assert.equal(result.EURUSD.news_impact_score, 0.6);
});

test('positive-sentiment headlines shift market_quality above 0.5', () => {
  const result = aggregateNewsIntelligence({
    headlineClassifications: [{ entities: ['USD'], sentiment: 1, impact: 0.5 }],
  });
  assert.equal(result.EURUSD.market_quality, 1.0);
});

test('negative-sentiment headlines shift market_quality below 0.5', () => {
  const result = aggregateNewsIntelligence({
    headlineClassifications: [{ entities: ['USD'], sentiment: -1, impact: 0.5 }],
  });
  assert.equal(result.EURUSD.market_quality, 0.0);
});

test('market_quality is the AVERAGE of multiple relevant headlines this cycle', () => {
  const result = aggregateNewsIntelligence({
    headlineClassifications: [
      { entities: ['USD'], sentiment: 1, impact: 0.5 },
      { entities: ['USD'], sentiment: -1, impact: 0.5 },
    ],
  });
  assert.equal(result.EURUSD.market_quality, 0.5, 'opposing headlines should average out to neutral');
});

test('market_quality never leaves [0, 1] even with extreme/skewed sentiment averages', () => {
  const result = aggregateNewsIntelligence({
    headlineClassifications: [
      { entities: ['USD'], sentiment: 1, impact: 1 },
      { entities: ['USD'], sentiment: 1, impact: 1 },
      { entities: ['USD'], sentiment: 1, impact: 1 },
    ],
  });
  assert.ok(result.EURUSD.market_quality >= 0 && result.EURUSD.market_quality <= 1);
  assert.equal(result.EURUSD.market_quality, 1.0);
});

test('an instrument untouched by headlines keeps market_quality at exactly 0.5, not skewed by other instruments\' headlines', () => {
  const result = aggregateNewsIntelligence({
    headlineClassifications: [{ entities: ['JPY'], sentiment: 1, impact: 1 }],
  });
  assert.equal(result.USDJPY.market_quality, 1.0);
  assert.equal(result.EURUSD.market_quality, 0.5);
});
