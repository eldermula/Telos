'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateMicroCircuitBreaker,
  isBootstrapSingleLossOverrideConditionMet,
  resolveStrategyModeWithBootstrapOverride,
} = require('../src/microCircuitBreaker');
const { STRATEGY_A, STRATEGY_B, HALTED, evaluateMacroCircuitBreaker } = require('../src/macroCircuitBreaker');

const baseInputs = {
  marketVolatility: 'NORMAL',
  consecutiveLosses: 0,
  dailyDrawdownPct: 0.0,
  strategyConfidence: 1.0,
};

// --- Base rule: each of the four conditions, in isolation --------------

test('no conditions triggered -> risk not forced', () => {
  const result = evaluateMicroCircuitBreaker(baseInputs);
  assert.equal(result.forcedToEmergencyFloor, false);
  assert.equal(result.forcedRisk, null);
  assert.deepEqual(result.triggeredConditions, {
    highVolatility: false,
    twoStrike: false,
    dailyDrawdown: false,
    lowConfidence: false,
  });
});

test('HIGH market volatility alone forces the emergency floor', () => {
  const result = evaluateMicroCircuitBreaker({ ...baseInputs, marketVolatility: 'HIGH' });
  assert.equal(result.forcedToEmergencyFloor, true);
  assert.equal(result.forcedRisk, 0.01);
  assert.equal(result.triggeredConditions.highVolatility, true);
});

test('Two-Strike Rule: 1 consecutive loss does not trigger', () => {
  const result = evaluateMicroCircuitBreaker({ ...baseInputs, consecutiveLosses: 1 });
  assert.equal(result.triggeredConditions.twoStrike, false);
  assert.equal(result.forcedToEmergencyFloor, false);
});

test('Two-Strike Rule: exactly 2 consecutive losses triggers (inclusive)', () => {
  const result = evaluateMicroCircuitBreaker({ ...baseInputs, consecutiveLosses: 2 });
  assert.equal(result.triggeredConditions.twoStrike, true);
  assert.equal(result.forcedToEmergencyFloor, true);
});

test('daily drawdown: just under 15% does not trigger', () => {
  const result = evaluateMicroCircuitBreaker({ ...baseInputs, dailyDrawdownPct: 0.1499 });
  assert.equal(result.triggeredConditions.dailyDrawdown, false);
});

test('daily drawdown: exactly 15% triggers (inclusive)', () => {
  const result = evaluateMicroCircuitBreaker({ ...baseInputs, dailyDrawdownPct: 0.15 });
  assert.equal(result.triggeredConditions.dailyDrawdown, true);
  assert.equal(result.forcedToEmergencyFloor, true);
});

test('confidence: exactly 80% does not trigger (strictly "<", not "<=")', () => {
  const result = evaluateMicroCircuitBreaker({ ...baseInputs, strategyConfidence: 0.80 });
  assert.equal(result.triggeredConditions.lowConfidence, false);
});

test('confidence: just under 80% triggers', () => {
  const result = evaluateMicroCircuitBreaker({ ...baseInputs, strategyConfidence: 0.7999 });
  assert.equal(result.triggeredConditions.lowConfidence, true);
  assert.equal(result.forcedToEmergencyFloor, true);
});

test('multiple conditions can be true simultaneously, still just one forced outcome', () => {
  const result = evaluateMicroCircuitBreaker({
    marketVolatility: 'HIGH',
    consecutiveLosses: 3,
    dailyDrawdownPct: 0.20,
    strategyConfidence: 0.5,
  });
  assert.equal(result.triggeredConditions.highVolatility, true);
  assert.equal(result.triggeredConditions.twoStrike, true);
  assert.equal(result.triggeredConditions.dailyDrawdown, true);
  assert.equal(result.triggeredConditions.lowConfidence, true);
  assert.equal(result.forcedToEmergencyFloor, true);
  assert.equal(result.forcedRisk, 0.01);
});

// --- validation ----------------------------------------------------------

test('rejects an invalid marketVolatility value', () => {
  assert.throws(
    () => evaluateMicroCircuitBreaker({ ...baseInputs, marketVolatility: 'MEDIUM' }),
    RangeError
  );
});

test('rejects a negative consecutiveLosses', () => {
  assert.throws(
    () => evaluateMicroCircuitBreaker({ ...baseInputs, consecutiveLosses: -1 }),
    RangeError
  );
});

test('rejects an out-of-range strategyConfidence', () => {
  assert.throws(
    () => evaluateMicroCircuitBreaker({ ...baseInputs, strategyConfidence: 1.5 }),
    RangeError
  );
});

// --- Bootstrap single-loss override: condition check ---------------------

test('override condition: balance above $10 never triggers, win or loss', () => {
  assert.equal(
    isBootstrapSingleLossOverrideConditionMet({ balanceBeforeTrade: 10.01, tradeWasLoss: true }),
    false
  );
});

test('override condition: balance at or below $10 with a win does not trigger', () => {
  assert.equal(
    isBootstrapSingleLossOverrideConditionMet({ balanceBeforeTrade: 8, tradeWasLoss: false }),
    false
  );
});

test('override condition: exactly $10 with a loss triggers (inclusive)', () => {
  assert.equal(
    isBootstrapSingleLossOverrideConditionMet({ balanceBeforeTrade: 10, tradeWasLoss: true }),
    true
  );
});

test('override condition: a single loss on the very first strike is enough (no waiting for a second)', () => {
  // Deliberately does not take consecutiveLosses as an input at all —
  // this function fires on this one loss regardless of loss history.
  assert.equal(
    isBootstrapSingleLossOverrideConditionMet({ balanceBeforeTrade: 3, tradeWasLoss: true }),
    true
  );
});

test('override condition rejects a non-boolean tradeWasLoss', () => {
  assert.throws(
    () => isBootstrapSingleLossOverrideConditionMet({ balanceBeforeTrade: 10, tradeWasLoss: 'yes' }),
    RangeError
  );
});

// --- Composition with the Section 6/6.1 macro breaker result -------------

test('override escalates A -> B when the macro drawdown check alone left it at A', () => {
  // Small loss at the bootstrap ceiling: e.g. $10 -> $9.50, only 5% down
  // from peak — nowhere near the macro breaker's 45% threshold, so the
  // macro check alone leaves it at STRATEGY_A.
  const macroResult = evaluateMacroCircuitBreaker({
    activeTradingBalance: 9.5,
    peakEquity: 10,
    activeStrategyMode: STRATEGY_A,
  });
  assert.equal(macroResult.activeStrategyMode, STRATEGY_A);

  const composed = resolveStrategyModeWithBootstrapOverride({
    macroResult,
    balanceBeforeTrade: 10,
    tradeWasLoss: true,
  });

  assert.equal(composed.activeStrategyMode, STRATEGY_B);
  assert.equal(composed.strategySwitched, true);
  assert.equal(composed.bootstrapSingleLossOverrideTriggered, true);
  assert.equal(composed.killActiveExposure, true);
  assert.equal(composed.emergencyNotificationRequired, true);
});

test('override is a no-op when the macro check already escalated to STRATEGY_B on its own', () => {
  // Full flat-cap loss: $10 -> $3, 70% down from peak — macro breaker
  // already fires on drawdown alone (per macroCircuitBreaker.test.js).
  const macroResult = evaluateMacroCircuitBreaker({
    activeTradingBalance: 3,
    peakEquity: 10,
    activeStrategyMode: STRATEGY_A,
  });
  assert.equal(macroResult.activeStrategyMode, STRATEGY_B);
  assert.equal(macroResult.macroBreachTriggered, true);

  const composed = resolveStrategyModeWithBootstrapOverride({
    macroResult,
    balanceBeforeTrade: 10,
    tradeWasLoss: true,
  });

  // Same outcome, but the override itself did not need to fire —
  // macroBreachTriggered already explains the transition.
  assert.equal(composed.activeStrategyMode, STRATEGY_B);
  assert.equal(composed.bootstrapSingleLossOverrideTriggered, false);
});

test('override never fires above the $10 ceiling, even on a large loss', () => {
  const macroResult = evaluateMacroCircuitBreaker({
    activeTradingBalance: 90,
    peakEquity: 100,
    activeStrategyMode: STRATEGY_A,
  });
  assert.equal(macroResult.activeStrategyMode, STRATEGY_A);

  const composed = resolveStrategyModeWithBootstrapOverride({
    macroResult,
    balanceBeforeTrade: 100, // well above the $10 bootstrap ceiling
    tradeWasLoss: true,
  });

  assert.equal(composed.activeStrategyMode, STRATEGY_A);
  assert.equal(composed.bootstrapSingleLossOverrideTriggered, false);
});

test('override never downgrades an already-HALTED state', () => {
  const macroResult = evaluateMacroCircuitBreaker({
    activeTradingBalance: 3,
    peakEquity: 10,
    activeStrategyMode: HALTED,
  });
  assert.equal(macroResult.activeStrategyMode, HALTED);

  const composed = resolveStrategyModeWithBootstrapOverride({
    macroResult,
    balanceBeforeTrade: 10,
    tradeWasLoss: true,
  });

  assert.equal(composed.activeStrategyMode, HALTED);
  assert.equal(composed.bootstrapSingleLossOverrideTriggered, false);
});

test('a win at the bootstrap ceiling never triggers the override, regardless of macro result', () => {
  const macroResult = evaluateMacroCircuitBreaker({
    activeTradingBalance: 10,
    peakEquity: 10,
    activeStrategyMode: STRATEGY_A,
  });

  const composed = resolveStrategyModeWithBootstrapOverride({
    macroResult,
    balanceBeforeTrade: 10,
    tradeWasLoss: false,
  });

  assert.equal(composed.activeStrategyMode, STRATEGY_A);
  assert.equal(composed.bootstrapSingleLossOverrideTriggered, false);
});
