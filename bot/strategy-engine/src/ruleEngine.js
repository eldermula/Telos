'use strict';

const { detectEmaCross, detectBreakout, detectRsiReversion } = require('./signals');

// 08_Bot_Architecture.md Section 13's confirmed confidence formula:
// base_confidence nudged by how far past its own regime_fit threshold
// the current reading is, clamped [0,1]. 0.5 is a deliberately
// conservative starting scale — flagged for recalibration once real
// trade outcomes exist, not before.
const REGIME_MARGIN_CONFIDENCE_SCALE = 0.5;

/**
 * Cheap pre-check (Section 9, Module 4): does this instrument's
 * current regime even suit this strategy? Checked before any signal
 * math runs, so a strategy that doesn't fit isn't evaluated further.
 */
function regimeFits(regimeFit, marketIntelligence) {
  if (!regimeFit) return true;
  if (regimeFit.trend_quality_min !== undefined && marketIntelligence.trend_quality < regimeFit.trend_quality_min) {
    return false;
  }
  if (regimeFit.trend_quality_max !== undefined && marketIntelligence.trend_quality > regimeFit.trend_quality_max) {
    return false;
  }
  if (
    regimeFit.market_volatility_in !== undefined &&
    !regimeFit.market_volatility_in.includes(marketIntelligence.market_volatility)
  ) {
    return false;
  }
  return true;
}

/**
 * How far past its own threshold the current reading is, roughly
 * normalized to [0,1] for the confidence bonus. `market_volatility_in`
 * is categorical (HIGH/NORMAL/LOW) rather than continuous, so it gets
 * a small fixed bonus for matching exactly rather than a graduated one.
 */
function regimeMargin(regimeFit, marketIntelligence) {
  if (!regimeFit) return 0;
  if (regimeFit.trend_quality_min !== undefined) {
    return marketIntelligence.trend_quality - regimeFit.trend_quality_min;
  }
  if (regimeFit.trend_quality_max !== undefined) {
    return regimeFit.trend_quality_max - marketIntelligence.trend_quality;
  }
  if (regimeFit.market_volatility_in !== undefined) return 0.1;
  return 0;
}

function computeConfidence(baseConfidence, margin) {
  return Math.max(0, Math.min(1, baseConfidence + margin * REGIME_MARGIN_CONFIDENCE_SCALE));
}

function computeSignal(signal, bars) {
  switch (signal.type) {
    case 'ema_cross':
      return detectEmaCross(bars, { fastPeriod: signal.fast_period, slowPeriod: signal.slow_period });
    case 'breakout':
      return detectBreakout(bars, { lookbackBars: signal.lookback_bars });
    case 'rsi_reversion':
      return detectRsiReversion(bars, {
        period: signal.period,
        oversold: signal.oversold,
        overbought: signal.overbought,
      });
    default:
      return null;
  }
}

/**
 * Evaluates one `candidate_strategies` row against one instrument's
 * current Module 2 output + price bars. Returns `null` for a WAIT —
 * either the regime doesn't fit, or the signal didn't fire this bar —
 * so callers only ever see real BUY/SELL candidates, never a
 * "no-op" result they'd have to filter out themselves.
 */
function evaluateStrategy(strategy, { marketIntelligence, bars }) {
  const ruleSet = strategy.rule_set;
  if (!regimeFits(ruleSet.regime_fit, marketIntelligence)) return null;

  const signal = computeSignal(ruleSet.signal, bars);
  if (!signal) return null;

  const margin = regimeMargin(ruleSet.regime_fit, marketIntelligence);
  const confidence = computeConfidence(ruleSet.base_confidence, margin);

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    direction: signal.direction,
    confidence,
    stopRule: ruleSet.stop,
    targetRule: ruleSet.target,
  };
}

module.exports = {
  evaluateStrategy,
  regimeFits,
  regimeMargin,
  computeConfidence,
  computeSignal,
  REGIME_MARGIN_CONFIDENCE_SCALE,
};
