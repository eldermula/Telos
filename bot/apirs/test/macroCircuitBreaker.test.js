'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STRATEGY_A,
  STRATEGY_B,
  HALTED,
  evaluateMacroCircuitBreaker,
  isTradeAllowedUnderStrategyB,
  getStrategyBRisk,
  isTierProgressionFrozen,
} = require('../src/macroCircuitBreaker');
const { bootstrapRiskPct } = require('../src/tierMatrix');

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be close to ${expected}`
  );
}

// --- Rule 1: peak equity tracking -----------------------------------------

test('peak equity updates to a new high, stays put on a lower balance', () => {
  const higher = evaluateMacroCircuitBreaker({
    activeTradingBalance: 120,
    peakEquity: 100,
    activeStrategyMode: STRATEGY_A,
  });
  assert.equal(higher.peakEquity, 120);

  const lower = evaluateMacroCircuitBreaker({
    activeTradingBalance: 90,
    peakEquity: 100,
    activeStrategyMode: STRATEGY_A,
  });
  assert.equal(lower.peakEquity, 100);
});

// --- STRATEGY_A -> STRATEGY_B (45% threshold) -----------------------------

test('stays in STRATEGY_A below the 45% drawdown threshold', () => {
  const result = evaluateMacroCircuitBreaker({
    activeTradingBalance: 56, // 44% down from peak 100
    peakEquity: 100,
    activeStrategyMode: STRATEGY_A,
  });
  assertClose(result.drawdownFromPeak, 0.44);
  assert.equal(result.activeStrategyMode, STRATEGY_A);
  assert.equal(result.macroBreachTriggered, false);
});

test('switches to STRATEGY_B exactly at the 45% drawdown threshold (inclusive)', () => {
  const result = evaluateMacroCircuitBreaker({
    activeTradingBalance: 55, // exactly 45% down from peak 100
    peakEquity: 100,
    activeStrategyMode: STRATEGY_A,
  });
  assertClose(result.drawdownFromPeak, 0.45);
  assert.equal(result.activeStrategyMode, STRATEGY_B);
  assert.equal(result.macroBreachTriggered, true);
  assert.equal(result.strategySwitched, true);
  assert.equal(result.killActiveExposure, true);
  assert.equal(result.emergencyNotificationRequired, true);
});

// --- The specific scenario requested: single large bootstrap-phase loss --

test('a single max-risk bootstrap loss stays under the macro threshold', () => {
  // Account at the $10 flat-cap bootstrap ceiling: risk = 10% per trade.
  const balanceBeforeLoss = 10;
  const riskPct = bootstrapRiskPct(balanceBeforeLoss);
  assertClose(riskPct, 0.10);

  const lossAmount = balanceBeforeLoss * riskPct; // $1 lost on a $10 account
  const balanceAfterLoss = balanceBeforeLoss - lossAmount; // $9

  const result = evaluateMacroCircuitBreaker({
    activeTradingBalance: balanceAfterLoss,
    peakEquity: balanceBeforeLoss, // $10 was the peak going into this trade
    activeStrategyMode: STRATEGY_A,
  });

  // A single full-ceiling loss is a 10% drawdown — well under the 45%
  // macro threshold, so the macro breaker alone leaves the account in
  // STRATEGY_A. Escalation in the bootstrap phase is owned by Section 7's
  // single-loss override (microCircuitBreaker.js), not by this breaker.
  assertClose(result.drawdownFromPeak, 0.10);
  assert.equal(result.macroBreachTriggered, false);
  assert.equal(result.activeStrategyMode, STRATEGY_A);
  assert.equal(result.haltTriggered, false);
});

// --- STRATEGY_B -> HALTED (60% secondary floor) ---------------------------

test('stays in STRATEGY_B below the 60% halt floor', () => {
  const result = evaluateMacroCircuitBreaker({
    activeTradingBalance: 41, // 59% down from peak 100
    peakEquity: 100,
    activeStrategyMode: STRATEGY_B,
  });
  assert.equal(result.activeStrategyMode, STRATEGY_B);
  assert.equal(result.haltTriggered, false);
});

test('escalates STRATEGY_B to HALTED exactly at the 60% drawdown floor', () => {
  const result = evaluateMacroCircuitBreaker({
    activeTradingBalance: 40, // exactly 60% down from peak 100
    peakEquity: 100,
    activeStrategyMode: STRATEGY_B,
  });
  assert.equal(result.activeStrategyMode, HALTED);
  assert.equal(result.haltTriggered, true);
  assert.equal(result.killActiveExposure, true);
});

test('a second evaluation cycle can escalate B to HALTED even though A never jumps straight there', () => {
  // First cycle: catastrophic loss from A, past both thresholds -> lands in B.
  const first = evaluateMacroCircuitBreaker({
    activeTradingBalance: 30, // 70% down from peak 100
    peakEquity: 100,
    activeStrategyMode: STRATEGY_A,
  });
  assert.equal(first.activeStrategyMode, STRATEGY_B);

  // Second cycle: still that deep, now evaluated FROM STRATEGY_B -> escalates.
  const second = evaluateMacroCircuitBreaker({
    activeTradingBalance: 30,
    peakEquity: first.peakEquity,
    activeStrategyMode: first.activeStrategyMode,
  });
  assert.equal(second.activeStrategyMode, HALTED);
});

// --- STRATEGY_B -> STRATEGY_A recovery hysteresis -------------------------

test('does not recover at exactly 22.5% drawdown ("under", not "at or under")', () => {
  const result = evaluateMacroCircuitBreaker({
    activeTradingBalance: 77.5, // exactly 22.5% down from peak 100
    peakEquity: 100,
    activeStrategyMode: STRATEGY_B,
  });
  assert.equal(result.activeStrategyMode, STRATEGY_B);
  assert.equal(result.recoveredToStrategyA, false);
});

test('recovers to STRATEGY_A once drawdown drops just under 22.5%', () => {
  const result = evaluateMacroCircuitBreaker({
    activeTradingBalance: 77.6, // 22.4% down from peak 100
    peakEquity: 100,
    activeStrategyMode: STRATEGY_B,
  });
  assert.equal(result.activeStrategyMode, STRATEGY_A);
  assert.equal(result.recoveredToStrategyA, true);
});

// --- HALTED is terminal ----------------------------------------------------

test('HALTED never self-clears, even if balance fully recovers to peak', () => {
  const result = evaluateMacroCircuitBreaker({
    activeTradingBalance: 100,
    peakEquity: 100,
    activeStrategyMode: HALTED,
  });
  assert.equal(result.activeStrategyMode, HALTED);
  assert.equal(result.strategySwitched, false);
});

// --- validation --------------------------------------------------------

test('rejects an invalid strategy mode', () => {
  assert.throws(
    () => evaluateMacroCircuitBreaker({ activeTradingBalance: 100, peakEquity: 100, activeStrategyMode: 'BOGUS' }),
    RangeError
  );
});

test('rejects non-positive peakEquity', () => {
  assert.throws(
    () => evaluateMacroCircuitBreaker({ activeTradingBalance: 10, peakEquity: 0, activeStrategyMode: STRATEGY_A }),
    RangeError
  );
});

// --- Section 6.1 helpers ---------------------------------------------------

test('isTradeAllowedUnderStrategyB — 0.90 confidence bar, inclusive', () => {
  assert.equal(isTradeAllowedUnderStrategyB(0.90), true);
  assert.equal(isTradeAllowedUnderStrategyB(0.899999), false);
  assert.equal(isTradeAllowedUnderStrategyB(1.0), true);
});

test('getStrategyBRisk — flat 1%, independent of tier', () => {
  assertClose(getStrategyBRisk(), 0.01);
});

test('isTierProgressionFrozen — only false in STRATEGY_A', () => {
  assert.equal(isTierProgressionFrozen(STRATEGY_A), false);
  assert.equal(isTierProgressionFrozen(STRATEGY_B), true);
  assert.equal(isTierProgressionFrozen(HALTED), true);
});
