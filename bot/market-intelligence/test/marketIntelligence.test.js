'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateMarketIntelligence,
  classifyVolatility,
  InsufficientDataError,
} = require('../src/marketIntelligence');
const { trendingBars, choppyBars, volatilitySpikeBars, flatBars } = require('./fixtures');

test('throws InsufficientDataError when there are too few bars', () => {
  const bars = trendingBars(10);
  assert.throws(() => evaluateMarketIntelligence(bars), InsufficientDataError);
});

test('returns a well-formed result for a sufficiently long series', () => {
  const bars = trendingBars(60);
  const result = evaluateMarketIntelligence(bars);
  assert.equal(typeof result.trend_quality, 'number');
  assert.ok(result.trend_quality >= 0 && result.trend_quality <= 1);
  assert.ok(['LOW', 'NORMAL', 'HIGH'].includes(result.market_volatility));
  assert.ok(result.volatility_penalty >= 0 && result.volatility_penalty <= 1);
});

test('a clean uptrend produces a high trend_quality', () => {
  const result = evaluateMarketIntelligence(trendingBars(60));
  assert.ok(result.trend_quality > 0.8, `expected trend_quality > 0.8, got ${result.trend_quality}`);
});

test('a choppy range-bound market produces a low trend_quality', () => {
  const result = evaluateMarketIntelligence(choppyBars(60));
  assert.ok(result.trend_quality < 0.5, `expected trend_quality < 0.5, got ${result.trend_quality}`);
});

test('a volatility spike near the end pushes market_volatility to HIGH with a positive penalty', () => {
  const result = evaluateMarketIntelligence(volatilitySpikeBars(60, { spikeLength: 8 }), {
    atrPeriod: 14,
    atrRollingPeriod: 20,
  });
  assert.equal(result.market_volatility, 'HIGH');
  assert.ok(result.volatility_penalty > 0, `expected volatility_penalty > 0, got ${result.volatility_penalty}`);
});

test('a calm, steady-range market produces NORMAL/LOW volatility with ~0 penalty', () => {
  const result = evaluateMarketIntelligence(trendingBars(60));
  assert.ok(['LOW', 'NORMAL'].includes(result.market_volatility));
  assert.ok(result.volatility_penalty < 0.1, `expected near-zero penalty, got ${result.volatility_penalty}`);
});

test('a perfectly flat series does not crash and does not divide by zero', () => {
  const result = evaluateMarketIntelligence(flatBars(60));
  assert.equal(Number.isNaN(result.trend_quality), false);
  assert.equal(Number.isNaN(result.volatility_penalty), false);
  assert.equal(result.volatility_penalty, 0);
});

test('classifyVolatility boundaries match Section 9.0 thresholds', () => {
  assert.equal(classifyVolatility(0.5), 'LOW');
  assert.equal(classifyVolatility(0.79), 'LOW');
  assert.equal(classifyVolatility(0.8), 'NORMAL');
  assert.equal(classifyVolatility(1.0), 'NORMAL');
  assert.equal(classifyVolatility(1.3), 'NORMAL');
  assert.equal(classifyVolatility(1.31), 'HIGH');
  assert.equal(classifyVolatility(2.0), 'HIGH');
});
