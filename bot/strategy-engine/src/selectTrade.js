'use strict';

const { evaluateStrategy } = require('./ruleEngine');

/**
 * `strategies` is assumed pre-filtered to `status = 'active'` by the
 * caller (05_Database_Design.md Section 1.4 / Section 11's paper-
 * trading gate) — this module has no DB access and doesn't know what
 * "active" means, it just evaluates whatever pool it's handed.
 *
 * For one instrument: evaluates every active strategy against it,
 * returns the single highest-confidence non-WAIT candidate (or `null`
 * if every strategy either didn't fit the regime or produced no
 * signal this bar). An instrument contributes at most one candidate —
 * strategies never stack.
 */
function selectStrategyForInstrument(strategies, instrumentContext) {
  let best = null;
  for (const strategy of strategies) {
    const candidate = evaluateStrategy(strategy, instrumentContext);
    if (candidate && (!best || candidate.confidence > best.confidence)) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Module 4 — Strategy Engine (Selection), 08_Bot_Architecture.md
 * Section 9.0/13. `instrumentContexts` is one entry per watchlist
 * instrument: `{ symbol, marketIntelligence, newsIntelligence, bars }`.
 * Picks the single highest-confidence candidate across the *whole*
 * watchlist — Section 13's confirmed one-position-system-wide design
 * is enforced here, not left to the caller to remember. Returns
 * `null` if nothing fired anywhere this tick (a legitimate outcome,
 * not a failure — Module 1 just has nothing to route to APIRS).
 */
function selectTrade(strategies, instrumentContexts) {
  let best = null;

  for (const ctx of instrumentContexts) {
    const candidate = selectStrategyForInstrument(strategies, ctx);
    if (!candidate) continue;
    if (!best || candidate.confidence > best.candidate.confidence) {
      best = { candidate, ctx };
    }
  }

  if (!best) return null;

  return {
    chosen_instrument: best.ctx.symbol,
    strategy_id: best.candidate.strategyId,
    strategy_name: best.candidate.strategyName,
    direction: best.candidate.direction,
    strategy_confidence: best.candidate.confidence,
    stopRule: best.candidate.stopRule,
    targetRule: best.candidate.targetRule,
    marketIntelligence: best.ctx.marketIntelligence,
    newsIntelligence: best.ctx.newsIntelligence,
  };
}

module.exports = { selectTrade, selectStrategyForInstrument };
