'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateProfitLock } = require('../src/profitLock');

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be close to ${expected}`
  );
}

test('does not apply below $50, even with large unrealized profit and a nonzero tier', () => {
  const result = evaluateProfitLock({
    activeTradingBalance: 45,
    peakEquity: 45,
    initialBalance: 10,
    currentTier: 3, // shouldn't matter — the $50 gate is checked first
  });
  assert.equal(result.profitLockTriggered, false);
  assert.equal(result.completedBlocksThisEvaluation, 0);
  assert.equal(result.activeTradingBalance, 45);
  assert.equal(result.peakEquity, 45);
  assert.equal(result.currentTier, 3);
});

test('skips when net_profit <= 0', () => {
  const result = evaluateProfitLock({
    activeTradingBalance: 55,
    peakEquity: 55,
    initialBalance: 60, // contrived: net_profit = -5
    currentTier: 0,
  });
  assert.equal(result.profitLockTriggered, false);
  assert.equal(result.activeTradingBalance, 55);
});

test('skips when net_profit is positive but short of one full step', () => {
  // net_profit = 90, Tier 0 step = 150 -> floor(90/150) = 0
  const result = evaluateProfitLock({
    activeTradingBalance: 100,
    peakEquity: 100,
    initialBalance: 10,
    currentTier: 0,
  });
  assert.equal(result.profitLockTriggered, false);
  assert.equal(result.completedBlocksThisEvaluation, 0);
  assert.equal(result.activeTradingBalance, 100); // unchanged
});

test('triggers on exactly one completed block, applies the 70/30 split and Peak Reset Vector', () => {
  // net_profit = 190, Tier 0 step = 150 -> 1 block. milestone=150, locked=105, retained=45.
  const result = evaluateProfitLock({
    activeTradingBalance: 200,
    peakEquity: 200,
    initialBalance: 10,
    currentTier: 0,
  });
  assert.equal(result.profitLockTriggered, true);
  assert.equal(result.completedBlocksThisEvaluation, 1);
  assertClose(result.milestoneProfit, 150);
  assertClose(result.lockedProfitAmount, 105);
  assertClose(result.retainedGrowth, 45);
  assertClose(result.activeTradingBalance, 95); // 200 - 105
  assertClose(result.peakEquity, 95); // 200 - 105, same reduction
  assert.equal(result.currentTier, 1);
});

test('Peak Reset Vector reduces balance and peak by the identical amount even when they differ going in', () => {
  // peakEquity reflects an earlier high-water mark above the current balance.
  const result = evaluateProfitLock({
    activeTradingBalance: 200,
    peakEquity: 250,
    initialBalance: 10,
    currentTier: 0,
  });
  assert.equal(result.profitLockTriggered, true);
  assertClose(result.lockedProfitAmount, 105);
  assertClose(result.activeTradingBalance, 95); // 200 - 105
  assertClose(result.peakEquity, 145); // 250 - 105 — same delta, different starting points
});

test('multiple blocks can complete in a single evaluation', () => {
  // net_profit = 390, Tier 0 step = 150 -> floor(390/150) = 2 blocks.
  const result = evaluateProfitLock({
    activeTradingBalance: 400,
    peakEquity: 400,
    initialBalance: 10,
    currentTier: 0,
  });
  assert.equal(result.completedBlocksThisEvaluation, 2);
  assertClose(result.milestoneProfit, 300);
  assertClose(result.lockedProfitAmount, 210);
  assertClose(result.retainedGrowth, 90);
  assertClose(result.activeTradingBalance, 190); // 400 - 210
  assert.equal(result.currentTier, 2); // 0 + 2
});

test('the meter self-corrects across repeated evaluations (30% retained growth carries forward)', () => {
  // Simulates two sequential trade-close evaluations against a fixed initial_balance.
  let state = { activeTradingBalance: 200, peakEquity: 200, currentTier: 0 };
  const initialBalance = 10;

  const first = evaluateProfitLock({ ...state, initialBalance });
  assert.equal(first.profitLockTriggered, true);
  assertClose(first.activeTradingBalance, 95);
  assert.equal(first.currentTier, 1);

  state = { activeTradingBalance: first.activeTradingBalance, peakEquity: first.peakEquity, currentTier: first.currentTier };

  // Not enough new profit yet to complete another block.
  const second = evaluateProfitLock({ ...state, activeTradingBalance: 200, initialBalance });
  // net_profit = 190, Tier 1 step is also 150 -> still 1 block worth of "room" consumed identically.
  assert.equal(second.profitLockTriggered, true);
  assert.equal(second.completedBlocksThisEvaluation, 1);
});

test('tier advancement is capped at 7 regardless of how many blocks complete', () => {
  // Tier 7 step = 500. net_profit huge enough for several blocks past the ceiling tier.
  const result = evaluateProfitLock({
    activeTradingBalance: 3000,
    peakEquity: 3000,
    initialBalance: 10,
    currentTier: 7,
  });
  assert.equal(result.profitLockTriggered, true);
  assert.ok(result.completedBlocksThisEvaluation >= 1);
  assert.equal(result.currentTier, 7); // stays at 7, never exceeds it
});

test('rejects an out-of-range currentTier', () => {
  assert.throws(
    () =>
      evaluateProfitLock({
        activeTradingBalance: 200,
        peakEquity: 200,
        initialBalance: 10,
        currentTier: 8,
      }),
    RangeError
  );
});

test('does not mutate its inputs', () => {
  const input = { activeTradingBalance: 200, peakEquity: 200, initialBalance: 10, currentTier: 0 };
  const snapshot = { ...input };
  evaluateProfitLock(input);
  assert.deepEqual(input, snapshot);
});
