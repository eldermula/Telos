'use strict';

const {
  EMERGENCY_FLOOR_RISK,
  MICRO_DAILY_DRAWDOWN_LIMIT,
  MICRO_MIN_CONFIDENCE,
  MICRO_TWO_STRIKE_LOSS_COUNT,
} = require('./constants');
const { BOOTSTRAP_LOWER_BALANCE } = require('./tierMatrix');
const { STRATEGY_A, STRATEGY_B } = require('./macroCircuitBreaker');

const VALID_VOLATILITY = new Set(['LOW', 'NORMAL', 'HIGH']);

function assertUnitInterval(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be a finite number in [0, 1], got ${value}`);
  }
}

/**
 * 08_Bot_Architecture.md Section 7 (Micro Circuit Breaker) — base rule.
 *
 * Pure function: forces final applied position risk to exactly
 * EMERGENCY_FLOOR_RISK (1%) for the next trade if any of the four
 * independent conditions hold. This is a single-trade clamp on risk
 * *size* only — it never touches active_strategy_mode (that's Section
 * 6/6.1's territory). Applies at every balance/regime unchanged,
 * including throughout the Section 3a bootstrap phase.
 */
function evaluateMicroCircuitBreaker({
  marketVolatility,
  consecutiveLosses,
  dailyDrawdownPct,
  strategyConfidence,
}) {
  if (!VALID_VOLATILITY.has(marketVolatility)) {
    throw new RangeError(`marketVolatility must be one of ${[...VALID_VOLATILITY].join(', ')}, got ${marketVolatility}`);
  }
  if (!Number.isInteger(consecutiveLosses) || consecutiveLosses < 0) {
    throw new RangeError(`consecutiveLosses must be a non-negative integer, got ${consecutiveLosses}`);
  }
  if (!Number.isFinite(dailyDrawdownPct) || dailyDrawdownPct < 0) {
    throw new RangeError(`dailyDrawdownPct must be a non-negative finite number, got ${dailyDrawdownPct}`);
  }
  assertUnitInterval(strategyConfidence, 'strategyConfidence');

  const triggeredConditions = {
    highVolatility: marketVolatility === 'HIGH',
    twoStrike: consecutiveLosses >= MICRO_TWO_STRIKE_LOSS_COUNT,
    dailyDrawdown: dailyDrawdownPct >= MICRO_DAILY_DRAWDOWN_LIMIT,
    lowConfidence: strategyConfidence < MICRO_MIN_CONFIDENCE,
  };

  const forcedToEmergencyFloor = Object.values(triggeredConditions).some(Boolean);

  return {
    forcedToEmergencyFloor,
    forcedRisk: forcedToEmergencyFloor ? EMERGENCY_FLOOR_RISK : null,
    triggeredConditions,
  };
}

/**
 * Section 7 — settled Section 3a-specific addendum. Pure boolean check:
 * true when a trade taken at or near the 70% flat-cap bootstrap ceiling
 * (balance <= $10, per Section 3a) just resulted in a loss. Deliberately
 * ignores consecutive_losses entirely — this fires on the very first
 * such loss, tighter than the standard two-strike rule above by design.
 */
function isBootstrapSingleLossOverrideConditionMet({ balanceBeforeTrade, tradeWasLoss }) {
  if (!Number.isFinite(balanceBeforeTrade)) {
    throw new RangeError(`balanceBeforeTrade must be a finite number, got ${balanceBeforeTrade}`);
  }
  if (typeof tradeWasLoss !== 'boolean') {
    throw new RangeError(`tradeWasLoss must be a boolean, got ${tradeWasLoss}`);
  }
  return balanceBeforeTrade <= BOOTSTRAP_LOWER_BALANCE && tradeWasLoss;
}

/**
 * Composes the Section 7 bootstrap override on top of an already-computed
 * Section 6/6.1 macro breaker result, without modifying
 * macroCircuitBreaker.js itself. `macroResult` is whatever
 * evaluateMacroCircuitBreaker() returned for this same trade cycle.
 *
 * Only ever escalates STRATEGY_A -> STRATEGY_B. If the macro drawdown
 * check already moved the mode to STRATEGY_B or HALTED this cycle, this
 * is a no-op — never downgrades, never overrides the HALTED terminal
 * state. This keeps active_strategy_mode transitions effectively
 * single-owned even though two modules can each propose one.
 */
function resolveStrategyModeWithBootstrapOverride({ macroResult, balanceBeforeTrade, tradeWasLoss }) {
  const overrideConditionMet = isBootstrapSingleLossOverrideConditionMet({ balanceBeforeTrade, tradeWasLoss });

  if (overrideConditionMet && macroResult.activeStrategyMode === STRATEGY_A) {
    return {
      ...macroResult,
      activeStrategyMode: STRATEGY_B,
      strategySwitched: true,
      bootstrapSingleLossOverrideTriggered: true,
      killActiveExposure: true,
      emergencyNotificationRequired: true,
    };
  }

  return {
    ...macroResult,
    bootstrapSingleLossOverrideTriggered: false,
  };
}

module.exports = {
  evaluateMicroCircuitBreaker,
  isBootstrapSingleLossOverrideConditionMet,
  resolveStrategyModeWithBootstrapOverride,
};
