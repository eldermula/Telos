'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  recordTradeOutcome,
  computeLiveWinProbability,
  computeConsecutiveLosses,
} = require('../src/learningEngine');

// --- recordTradeOutcome ---------------------------------------------------

test('recordTradeOutcome appends without mutating the input array', () => {
  const history = [];
  const updated = recordTradeOutcome(history, { wasWin: true, pnlAmount: 12.5 });
  assert.equal(history.length, 0);
  assert.equal(updated.length, 1);
  assert.deepEqual(updated[0], { wasWin: true, pnlAmount: 12.5, conditions: null });
});

test('recordTradeOutcome stores the optional conditions snapshot verbatim', () => {
  const conditions = { strategyConfidence: 0.85, marketVolatility: 'NORMAL' };
  const updated = recordTradeOutcome([], { wasWin: false, pnlAmount: -5, conditions });
  assert.equal(updated[0].conditions, conditions);
});

test('recordTradeOutcome trims to the trailing 50 entries (rolling window)', () => {
  let history = [];
  for (let i = 0; i < 55; i += 1) {
    history = recordTradeOutcome(history, { wasWin: i % 2 === 0, pnlAmount: 1 });
  }
  assert.equal(history.length, 50);
});

test('recordTradeOutcome rejects a non-boolean wasWin', () => {
  assert.throws(
    () => recordTradeOutcome([], { wasWin: 'yes', pnlAmount: 1 }),
    RangeError
  );
});

test('recordTradeOutcome rejects a non-finite pnlAmount', () => {
  assert.throws(
    () => recordTradeOutcome([], { wasWin: true, pnlAmount: NaN }),
    RangeError
  );
});

test('recordTradeOutcome rejects a non-array history', () => {
  assert.throws(
    () => recordTradeOutcome(null, { wasWin: true, pnlAmount: 1 }),
    RangeError
  );
});

// --- computeLiveWinProbability ---------------------------------------------

test('computeLiveWinProbability returns the neutral default with no history', () => {
  assert.equal(computeLiveWinProbability([]), 0.5);
});

test('computeLiveWinProbability computes wins/total over the window', () => {
  let history = [];
  history = recordTradeOutcome(history, { wasWin: true, pnlAmount: 1 });
  history = recordTradeOutcome(history, { wasWin: true, pnlAmount: 1 });
  history = recordTradeOutcome(history, { wasWin: false, pnlAmount: -1 });
  history = recordTradeOutcome(history, { wasWin: false, pnlAmount: -1 });
  assert.equal(computeLiveWinProbability(history), 0.5);
});

test('computeLiveWinProbability only considers the trailing 50-trade window', () => {
  let history = [];
  // 50 losses, then 50 wins -> only the 50 wins should remain in the window.
  for (let i = 0; i < 50; i += 1) {
    history = recordTradeOutcome(history, { wasWin: false, pnlAmount: -1 });
  }
  for (let i = 0; i < 50; i += 1) {
    history = recordTradeOutcome(history, { wasWin: true, pnlAmount: 1 });
  }
  assert.equal(computeLiveWinProbability(history), 1.0);
});

// --- computeConsecutiveLosses ------------------------------------------------

test('computeConsecutiveLosses is 0 with no history', () => {
  assert.equal(computeConsecutiveLosses([]), 0);
});

test('computeConsecutiveLosses is 0 immediately after a win', () => {
  let history = [];
  history = recordTradeOutcome(history, { wasWin: false, pnlAmount: -1 });
  history = recordTradeOutcome(history, { wasWin: false, pnlAmount: -1 });
  history = recordTradeOutcome(history, { wasWin: true, pnlAmount: 1 });
  assert.equal(computeConsecutiveLosses(history), 0);
});

test('computeConsecutiveLosses counts trailing losses since the last win', () => {
  let history = [];
  history = recordTradeOutcome(history, { wasWin: true, pnlAmount: 1 });
  history = recordTradeOutcome(history, { wasWin: false, pnlAmount: -1 });
  history = recordTradeOutcome(history, { wasWin: false, pnlAmount: -1 });
  history = recordTradeOutcome(history, { wasWin: false, pnlAmount: -1 });
  assert.equal(computeConsecutiveLosses(history), 3);
});

test('computeConsecutiveLosses counts every entry when history is all losses', () => {
  let history = [];
  for (let i = 0; i < 4; i += 1) {
    history = recordTradeOutcome(history, { wasWin: false, pnlAmount: -1 });
  }
  assert.equal(computeConsecutiveLosses(history), 4);
});
