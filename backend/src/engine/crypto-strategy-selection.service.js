'use strict';

/**
 * Crypto Increment E — Module 4 twin for BTC/ETH only.
 * Uses crypto news (B) + crypto MI (C thresholds) + shared strategy-engine.
 * Never imports forex news/watchlist or bot-runtime.js.
 */

const path = require('path');
const cryptoMarketIntelligenceService = require('./crypto-market-intelligence.service');
const cryptoNewsIntelligenceService = require('./crypto-news-intelligence.service');
const candidateStrategiesRepository = require('./candidate-strategies.repository');

const cryptoNewsPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'bot',
  'crypto-news-intelligence',
  'src'
);
const { CRYPTO_WATCHLIST } = require(path.join(cryptoNewsPath, 'watchlist.js'));

const strategyEnginePath = path.join(__dirname, '..', '..', '..', 'bot', 'strategy-engine', 'src');
const { selectTrade } = require(path.join(strategyEnginePath, 'selectTrade.js'));
const { computeStopTarget } = require(path.join(strategyEnginePath, 'stopTarget.js'));

async function selectCryptoTradeAcrossWatchlist() {
  const [strategies, newsIntelligence] = await Promise.all([
    candidateStrategiesRepository.listActiveStrategies(),
    cryptoNewsIntelligenceService.getCryptoNewsIntelligence(),
  ]);

  const instrumentContexts = await Promise.all(
    CRYPTO_WATCHLIST.map(async (symbol) => {
      const marketIntelligence = await cryptoMarketIntelligenceService.getCryptoMarketIntelligence(
        symbol
      );
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
  selectCryptoTradeAcrossWatchlist,
  computeSelectionStopTarget,
  CRYPTO_WATCHLIST,
};
