'use strict';

/**
 * Increment 6.4 — these plumbing smoke tests (43/44/45) care whether
 * bot-runtime.js correctly *consumes* a Module 4 Selection result
 * (maps it into APIRS's tradeInput, persists trades.symbol, derives
 * stop/target from the ATR-based rule, resolves against real price)
 * — not whether a real EMA-cross/breakout/RSI-extreme happens to fire
 * on the live watchlist within this test run, which is edge-triggered
 * and can't be relied on to happen in any given short window. Module
 * 4's real, live selection logic is already independently verified by
 * smoke-strategy-selection-64.js.
 *
 * `directionForTick` alternates BUY/SELL per open-attempt, same as
 * the pre-6.4 stub, so both directions still get real exercise across
 * a test run. `strategyConfidence` is deliberately kept at the exact
 * same 0.85 the old stub used — below STRATEGY_B's 0.90 confidence
 * bar (08_Bot_Architecture.md Section 6.1) — so a loss-triggered
 * switch into STRATEGY_B still correctly rejects the next entry, the
 * same real branch these tests were already covering pre-6.4.
 */
function makeFakeStrategySelection({
  symbol = 'EURUSD',
  // Intentionally fixed below STRATEGY_B's 0.90 confidence bar (not an
  // oversight) — keeps the loss -> STRATEGY_B -> next-entry-rejected
  // branch exercised by these tests. See the file header for the why.
  strategyConfidence = 0.85,
  marketQuality = 0.7,
  trendQuality = 0.75,
  marketVolatility = 'NORMAL',
  // Deliberately tight (vs. a real ATR reading) so the resulting
  // stop/target resolve within a handful of real ticks against live
  // price noise — same intent as the old PAPER_STOP_DISTANCE_POINTS=3
  // override, just expressed as an ATR input now that stop distance
  // is ATR-multiple based (Module 4's confirmed stop/target rule).
  currentATR = 0.00002,
  stopMultiple = 1.5,
  targetRatio = 2,
} = {}) {
  let tickCount = 0;

  return {
    async selectTradeAcrossWatchlist() {
      const direction = tickCount % 2 === 0 ? 'BUY' : 'SELL';
      tickCount += 1;
      return {
        chosen_instrument: symbol,
        strategy_id: 'fake-strategy-id',
        strategy_name: 'MA Crossover',
        direction,
        strategy_confidence: strategyConfidence,
        stopRule: { multiple: stopMultiple },
        targetRule: { ratio: targetRatio },
        marketIntelligence: {
          trend_quality: trendQuality,
          market_volatility: marketVolatility,
          diagnostics: { currentATR, rollingAvgATR: currentATR },
        },
        newsIntelligence: { market_quality: marketQuality, news_impact_score: 0 },
      };
    },
  };
}

module.exports = { makeFakeStrategySelection };
