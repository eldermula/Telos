'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectTrade, selectStrategyForInstrument } = require('../src/selectTrade');
const { flatBars, emaCrossBars } = require('./fixtures');

const MA_CROSSOVER = {
  id: 'strat-ma',
  name: 'MA Crossover',
  rule_set: {
    regime_fit: { trend_quality_min: 0.6 },
    signal: { type: 'ema_cross', fast_period: 12, slow_period: 26 },
    stop: { type: 'atr_multiple', multiple: 1.5 },
    target: { type: 'reward_risk_ratio', ratio: 2 },
    base_confidence: 0.7,
  },
};

const RSI_REVERSION = {
  id: 'strat-rsi',
  name: 'RSI Mean Reversion',
  rule_set: {
    regime_fit: { trend_quality_max: 0.4 },
    signal: { type: 'rsi_reversion', period: 14, oversold: 30, overbought: 70 },
    stop: { type: 'atr_multiple', multiple: 1.5 },
    target: { type: 'reward_risk_ratio', ratio: 2 },
    base_confidence: 0.7,
  },
};

const STRATEGIES = [MA_CROSSOVER, RSI_REVERSION];

const uptrendBars = emaCrossBars({ direction: 'BUY' });

test('selectStrategyForInstrument: null when nothing fires for this instrument', () => {
  const result = selectStrategyForInstrument(STRATEGIES, {
    marketIntelligence: { trend_quality: 0.5, market_volatility: 'NORMAL' },
    bars: flatBars(40),
  });
  assert.equal(result, null);
});

test('selectStrategyForInstrument: returns the single strategy that fires', () => {
  const result = selectStrategyForInstrument(STRATEGIES, {
    marketIntelligence: { trend_quality: 0.9, market_volatility: 'NORMAL' },
    bars: uptrendBars,
  });
  assert.ok(result);
  assert.equal(result.strategyName, 'MA Crossover');
  assert.equal(result.direction, 'BUY');
});

test('selectTrade: null when no instrument produces a candidate', () => {
  const contexts = [
    { symbol: 'EURUSD', marketIntelligence: { trend_quality: 0.5, market_volatility: 'NORMAL' }, bars: flatBars(40) },
    { symbol: 'GBPUSD', marketIntelligence: { trend_quality: 0.5, market_volatility: 'NORMAL' }, bars: flatBars(40) },
  ];
  assert.equal(selectTrade(STRATEGIES, contexts), null);
});

test('selectTrade: picks the single highest-confidence candidate across the whole watchlist', () => {
  const contexts = [
    {
      symbol: 'EURUSD',
      marketIntelligence: { trend_quality: 0.62, market_volatility: 'NORMAL' }, // just barely fits -> lower confidence
      newsIntelligence: { market_quality: 0.5, news_impact_score: 0 },
      bars: uptrendBars,
    },
    {
      symbol: 'GBPUSD',
      marketIntelligence: { trend_quality: 0.99, market_volatility: 'NORMAL' }, // fits with a wide margin -> higher confidence
      newsIntelligence: { market_quality: 0.6, news_impact_score: 0.2 },
      bars: uptrendBars,
    },
    {
      symbol: 'USDJPY',
      marketIntelligence: { trend_quality: 0.5, market_volatility: 'NORMAL' }, // no fit anywhere -> no candidate
      newsIntelligence: { market_quality: 0.5, news_impact_score: 0 },
      bars: flatBars(40),
    },
  ];

  const result = selectTrade(STRATEGIES, contexts);
  assert.ok(result);
  assert.equal(result.chosen_instrument, 'GBPUSD');
  assert.equal(result.direction, 'BUY');
  assert.equal(result.strategy_name, 'MA Crossover');
  assert.ok(result.strategy_confidence > 0.7);
  assert.deepEqual(result.newsIntelligence, { market_quality: 0.6, news_impact_score: 0.2 });
});

test('selectTrade: only ever picks one instrument, never more than one candidate', () => {
  const contexts = [
    { symbol: 'EURUSD', marketIntelligence: { trend_quality: 0.9, market_volatility: 'NORMAL' }, bars: uptrendBars },
    { symbol: 'GBPUSD', marketIntelligence: { trend_quality: 0.9, market_volatility: 'NORMAL' }, bars: uptrendBars },
  ];
  const result = selectTrade(STRATEGIES, contexts);
  assert.ok(result);
  assert.equal(typeof result.chosen_instrument, 'string');
});
