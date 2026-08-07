'use strict';

const path = require('path');
const marketIntelligenceService = require('./market-intelligence.service');
const newsIntelligenceService = require('./news-intelligence.service');
const candidateStrategiesRepository = require('./candidate-strategies.repository');

const newsIntelligencePath = path.join(__dirname, '..', '..', '..', 'bot', 'news-intelligence', 'src');
const { WATCHLIST } = require(path.join(newsIntelligencePath, 'watchlist.js'));

const strategyEnginePath = path.join(__dirname, '..', '..', '..', 'bot', 'strategy-engine', 'src');
const { selectTrade } = require(path.join(strategyEnginePath, 'selectTrade.js'));
const { computeStopTarget } = require(path.join(strategyEnginePath, 'stopTarget.js'));

/**
 * Module 4 — Strategy Engine (Selection), 08_Bot_Architecture.md
 * Section 9.0/13. Every tick: pulls Module 2 (per-instrument, its own
 * ~20s cache) + Module 3 (once, its own ~20s cache, already computed
 * for the whole watchlist) for every watchlist instrument, then hands
 * it all to the pure `bot/strategy-engine` `selectTrade()` to pick at
 * most one instrument + strategy + direction (Section 13's confirmed
 * one-position-system-wide design). Returns `null` on a no-trade
 * tick — a legitimate outcome (nothing fired anywhere), not a
 * failure; the caller (bot-runtime.js) treats it exactly like APIRS
 * rejecting a trade.
 */
async function selectTradeAcrossWatchlist() {
  const [strategies, newsIntelligence] = await Promise.all([
    candidateStrategiesRepository.listActiveStrategies(),
    newsIntelligenceService.getNewsIntelligence(),
  ]);

  const instrumentContexts = await Promise.all(
    WATCHLIST.map(async (symbol) => {
      const marketIntelligence = await marketIntelligenceService.getMarketIntelligence(symbol);
      return {
        symbol,
        marketIntelligence,
        newsIntelligence: newsIntelligence[symbol],
        // Module 2's Section 9.1 fallback carries no real bars behind
        // it — an instrument in fallback this tick simply can't have
        // a signal computed, same WAIT outcome as any strategy that
        // doesn't fire, not a special case.
        bars: marketIntelligence.stale ? null : marketIntelligence.bars,
      };
    })
  );

  const evaluable = instrumentContexts.filter((ctx) => Array.isArray(ctx.bars));
  return selectTrade(strategies, evaluable);
}

/**
 * Converts a Selection result + a live entry price into actual stop/
 * target price levels, using the chosen instrument's own ATR
 * (Module 2's diagnostics) — kept as a thin wrapper here rather than
 * making bot-runtime.js reach into `bot/strategy-engine` directly.
 */
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

module.exports = { selectTradeAcrossWatchlist, computeSelectionStopTarget };
