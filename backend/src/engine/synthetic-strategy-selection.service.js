'use strict';

/**
 * Synthetics Module 4 twin — Volatility Index watchlist only.
 * Uses synthetic MI (first-cut thresholds) + fixed-neutral news + shared
 * strategy-engine. Never imports forex/crypto runtimes.
 */

const path = require('path');
const syntheticMarketIntelligenceService = require('./synthetic-market-intelligence.service');
const syntheticNewsIntelligenceService = require('./synthetic-news-intelligence.service');
const candidateStrategiesRepository = require('./candidate-strategies.repository');

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

const strategyEnginePath = path.join(__dirname, '..', '..', '..', 'bot', 'strategy-engine', 'src');
const { selectTrade } = require(path.join(strategyEnginePath, 'selectTrade.js'));
const { computeStopTarget } = require(path.join(strategyEnginePath, 'stopTarget.js'));

async function selectSyntheticTradeAcrossWatchlist() {
  const [strategies, newsIntelligence] = await Promise.all([
    candidateStrategiesRepository.listActiveStrategies(),
    syntheticNewsIntelligenceService.getSyntheticNewsIntelligence(),
  ]);

  const instrumentContexts = await Promise.all(
    SYNTHETIC_WATCHLIST.map(async (symbol) => {
      const marketIntelligence =
        await syntheticMarketIntelligenceService.getSyntheticMarketIntelligence(symbol);
      return {
        symbol,
        marketIntelligence,
        newsIntelligence: newsIntelligence[symbol],
        bars: marketIntelligence.stale ? null : marketIntelligence.bars,
      };
    })
  );

  const evaluable = instrumentContexts.filter((ctx) => Array.isArray(ctx.bars));
  return selectTrade(strategies, evaluable);
}

function computeSelectionStopTarget(selection, entryPrice) {
  const currentATR = selection.marketIntelligence.diagnostics?.currentATR;
  return computeStopTarget({
    entryPrice,
    direction: selection.direction,
    currentATR,
    stopRule: selection.stopRule,
    targetRule: selection.targetRule,
  });
}

module.exports = {
  selectSyntheticTradeAcrossWatchlist,
  computeSelectionStopTarget,
  SYNTHETIC_WATCHLIST,
};
