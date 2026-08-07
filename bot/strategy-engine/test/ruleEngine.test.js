'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateStrategy, regimeFits, regimeMargin, computeConfidence } = require('../src/ruleEngine');
const { flatBars, emaCrossBars } = require('./fixtures');

const MA_CROSSOVER = {
  id: 'strat-1',
  name: 'MA Crossover',
  rule_set: {
    regime_fit: { trend_quality_min: 0.6 },
    signal: { type: 'ema_cross', fast_period: 12, slow_period: 26 },
    stop: { type: 'atr_multiple', multiple: 1.5 },
    target: { type: 'reward_risk_ratio', ratio: 2 },
    base_confidence: 0.7,
  },
};

const BREAKOUT = {
  id: 'strat-2',
  name: 'Breakout',
  rule_set: {
    regime_fit: { market_volatility_in: ['HIGH'] },
    signal: { type: 'breakout', lookback_bars: 20 },
    stop: { type: 'atr_multiple', multiple: 1.5 },
    target: { type: 'reward_risk_ratio', ratio: 2 },
    base_confidence: 0.7,
  },
};

test('regimeFits: trend_quality_min gates correctly', () => {
  assert.equal(regimeFits({ trend_quality_min: 0.6 }, { trend_quality: 0.7 }), true);
  assert.equal(regimeFits({ trend_quality_min: 0.6 }, { trend_quality: 0.5 }), false);
});

test('regimeFits: trend_quality_max gates correctly', () => {
  assert.equal(regimeFits({ trend_quality_max: 0.4 }, { trend_quality: 0.3 }), true);
  assert.equal(regimeFits({ trend_quality_max: 0.4 }, { trend_quality: 0.5 }), false);
});

test('regimeFits: market_volatility_in gates correctly', () => {
  assert.equal(regimeFits({ market_volatility_in: ['HIGH'] }, { market_volatility: 'HIGH' }), true);
  assert.equal(regimeFits({ market_volatility_in: ['HIGH'] }, { market_volatility: 'NORMAL' }), false);
});

test('regimeFits: no regime_fit always passes', () => {
  assert.equal(regimeFits(undefined, { trend_quality: 0 }), true);
});

test('regimeMargin + computeConfidence: exact threshold gives exactly base_confidence', () => {
  const margin = regimeMargin({ trend_quality_min: 0.6 }, { trend_quality: 0.6 });
  assert.equal(margin, 0);
  assert.equal(computeConfidence(0.7, margin), 0.7);
});

test('regimeMargin + computeConfidence: exceeding the threshold adds a bonus, clamped to 1', () => {
  const margin = regimeMargin({ trend_quality_min: 0.6 }, { trend_quality: 1.0 });
  assert.equal(Math.round(margin * 100) / 100, 0.4);
  // base 0.7 + 0.4*0.5 = 0.9
  assert.ok(Math.abs(computeConfidence(0.7, margin) - 0.9) < 1e-9);
  // A strategy with a very high base_confidence should still clamp at 1.
  assert.equal(computeConfidence(0.95, margin), 1);
});

test('evaluateStrategy: returns null when the regime does not fit, even with a real signal in the bars', () => {
  const bars = emaCrossBars({ direction: 'BUY' });
  const result = evaluateStrategy(MA_CROSSOVER, {
    marketIntelligence: { trend_quality: 0.3, market_volatility: 'NORMAL' },
    bars,
  });
  assert.equal(result, null);
});

test('evaluateStrategy: returns null (WAIT) when the regime fits but no signal fired this bar', () => {
  const result = evaluateStrategy(MA_CROSSOVER, {
    marketIntelligence: { trend_quality: 0.9, market_volatility: 'NORMAL' },
    bars: flatBars(40),
  });
  assert.equal(result, null);
});

test('evaluateStrategy: returns a real candidate when regime fits and the signal fires', () => {
  const bars = emaCrossBars({ direction: 'BUY' });
  const result = evaluateStrategy(MA_CROSSOVER, {
    marketIntelligence: { trend_quality: 0.9, market_volatility: 'NORMAL' },
    bars,
  });
  assert.ok(result, 'expected a candidate');
  assert.equal(result.direction, 'BUY');
  assert.equal(result.strategyName, 'MA Crossover');
  assert.ok(result.confidence > 0.7 && result.confidence <= 1);
});

test('evaluateStrategy: breakout strategy respects its categorical regime_fit', () => {
  const bars = [...flatBars(24)];
  const notHighVol = evaluateStrategy(BREAKOUT, {
    marketIntelligence: { trend_quality: 0.5, market_volatility: 'NORMAL' },
    bars,
  });
  assert.equal(notHighVol, null);
});
