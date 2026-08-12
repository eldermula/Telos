'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveExecutionMode,
  resolveExpectedAccountTypeForLayer0,
} = require('./execution-mode');
const { LIVE_TRADING_CONFIRMATION_TTL_MINUTES } = require('./live-trading-confirmation');

const TTL_MS = LIVE_TRADING_CONFIRMATION_TTL_MINUTES * 60 * 1000;

// Fresh relative to the process's `Date.now()` so the confirmation TTL
// doesn't reject every "correct inputs" case as stale. Built once at
// module load; each individual test that needs a specific age
// constructs its own.
const REAL_TIMESTAMP = new Date();

test('resolves real only when all three inputs are exactly correct', () => {
  assert.equal(
    resolveExecutionMode({
      realTradingEnabled: true,
      accountType: 'real',
      liveTradingConfirmedAt: REAL_TIMESTAMP,
    }),
    'real'
  );
});

test('a non-null, non-empty ISO string timestamp also counts as confirmed (when fresh)', () => {
  // Pass a Date close to now so isConfirmationActive's TTL doesn't
  // reject a hard-coded historical ISO string as stale.
  const freshIso = new Date().toISOString();
  assert.equal(
    resolveExecutionMode({
      realTradingEnabled: true,
      accountType: 'real',
      liveTradingConfirmedAt: freshIso,
    }),
    'real'
  );
});

test('a past-TTL confirmation timestamp resolves to paper', () => {
  const pastTtl = new Date(Date.now() - TTL_MS - 1000);
  assert.equal(
    resolveExecutionMode({
      realTradingEnabled: true,
      accountType: 'real',
      liveTradingConfirmedAt: pastTtl,
    }),
    'paper'
  );
});

// --- realTradingEnabled: every value other than the literal boolean
// true must resolve to paper, including truthy-looking strings/numbers.
test('realTradingEnabled=false -> paper even with everything else correct', () => {
  assert.equal(
    resolveExecutionMode({
      realTradingEnabled: false,
      accountType: 'real',
      liveTradingConfirmedAt: REAL_TIMESTAMP,
    }),
    'paper'
  );
});

for (const badEnabled of [undefined, null, 'true', 1, 0, 'yes', 'True']) {
  test(`realTradingEnabled=${JSON.stringify(badEnabled)} (not literal boolean true) -> paper`, () => {
    assert.equal(
      resolveExecutionMode({
        realTradingEnabled: badEnabled,
        accountType: 'real',
        liveTradingConfirmedAt: REAL_TIMESTAMP,
      }),
      'paper'
    );
  });
}

// --- accountType: only the exact string 'real' qualifies.
for (const badType of ['demo', 'contest', null, undefined, '', 'Real', 'REAL', 123, {}]) {
  test(`accountType=${JSON.stringify(badType)} (not exactly 'real') -> paper`, () => {
    assert.equal(
      resolveExecutionMode({
        realTradingEnabled: true,
        accountType: badType,
        liveTradingConfirmedAt: REAL_TIMESTAMP,
      }),
      'paper'
    );
  });
}

// --- liveTradingConfirmedAt: anything falsy (not just null/undefined)
// must resolve to paper.
const FALSY_CONFIRMED_AT_CASES = [
  ['null', null],
  ['undefined', undefined],
  ['0', 0],
  ['empty string', ''],
  ['false', false],
  ['NaN', NaN],
];
for (const [label, badConfirmedAt] of FALSY_CONFIRMED_AT_CASES) {
  test(`liveTradingConfirmedAt=${label} (falsy) -> paper`, () => {
    assert.equal(
      resolveExecutionMode({
        realTradingEnabled: true,
        accountType: 'real',
        liveTradingConfirmedAt: badConfirmedAt,
      }),
      'paper'
    );
  });
}

// --- All-false / all-missing combination — the "nothing is set" baseline.
test('all three inputs missing entirely -> paper', () => {
  assert.equal(resolveExecutionMode({}), 'paper');
});

test('all three inputs explicitly false/null -> paper', () => {
  assert.equal(
    resolveExecutionMode({
      realTradingEnabled: false,
      accountType: null,
      liveTradingConfirmedAt: null,
    }),
    'paper'
  );
});

// --- Exactly one input wrong at a time, other two correct — proves
// this is a genuine AND across all three, not e.g. two-of-three.
test('only realTradingEnabled wrong -> paper', () => {
  assert.equal(
    resolveExecutionMode({
      realTradingEnabled: false,
      accountType: 'real',
      liveTradingConfirmedAt: REAL_TIMESTAMP,
    }),
    'paper'
  );
});

test('only accountType wrong -> paper', () => {
  assert.equal(
    resolveExecutionMode({
      realTradingEnabled: true,
      accountType: 'demo',
      liveTradingConfirmedAt: REAL_TIMESTAMP,
    }),
    'paper'
  );
});

test('only liveTradingConfirmedAt wrong -> paper', () => {
  assert.equal(
    resolveExecutionMode({
      realTradingEnabled: true,
      accountType: 'real',
      liveTradingConfirmedAt: null,
    }),
    'paper'
  );
});

// --- Exactly two of three correct (the remaining one wrong) — every
// pairing, so no two-out-of-three combination is mistaken for enough.
test('realTradingEnabled + accountType correct, confirmedAt missing -> paper', () => {
  assert.equal(
    resolveExecutionMode({ realTradingEnabled: true, accountType: 'real', liveTradingConfirmedAt: undefined }),
    'paper'
  );
});

test('realTradingEnabled + confirmedAt correct, accountType wrong -> paper', () => {
  assert.equal(
    resolveExecutionMode({
      realTradingEnabled: true,
      accountType: 'contest',
      liveTradingConfirmedAt: REAL_TIMESTAMP,
    }),
    'paper'
  );
});

test('accountType + confirmedAt correct, realTradingEnabled wrong -> paper', () => {
  assert.equal(
    resolveExecutionMode({ realTradingEnabled: false, accountType: 'real', liveTradingConfirmedAt: REAL_TIMESTAMP }),
    'paper'
  );
});

// --- Return type discipline: the function must only ever return one
// of the two literal strings, never something else.
test('return value is always exactly the string "paper" or "real", nothing else', () => {
  const cases = [
    { realTradingEnabled: true, accountType: 'real', liveTradingConfirmedAt: REAL_TIMESTAMP },
    { realTradingEnabled: false, accountType: 'demo', liveTradingConfirmedAt: null },
    {},
  ];
  for (const input of cases) {
    const result = resolveExecutionMode(input);
    assert.ok(result === 'paper' || result === 'real', `unexpected return value: ${JSON.stringify(result)}`);
  }
});

// --- E1 dispatch bypass (allowDemoRealExecution) ---
// Controls which methods run. Must never rewrite Layer 0's account type.

test('E1: demo + bypass true + kill switch + confirmation → real (dispatch)', () => {
  assert.equal(
    resolveExecutionMode({
      realTradingEnabled: true,
      accountType: 'demo',
      liveTradingConfirmedAt: REAL_TIMESTAMP,
      allowDemoRealExecution: true,
    }),
    'real'
  );
});

test('E1: demo + bypass false → paper (bypass off)', () => {
  assert.equal(
    resolveExecutionMode({
      realTradingEnabled: true,
      accountType: 'demo',
      liveTradingConfirmedAt: REAL_TIMESTAMP,
      allowDemoRealExecution: false,
    }),
    'paper'
  );
});

test('E1: demo + bypass omitted → paper (default off)', () => {
  assert.equal(
    resolveExecutionMode({
      realTradingEnabled: true,
      accountType: 'demo',
      liveTradingConfirmedAt: REAL_TIMESTAMP,
    }),
    'paper'
  );
});

test('E1: contest + bypass true → paper (contest never qualifies)', () => {
  assert.equal(
    resolveExecutionMode({
      realTradingEnabled: true,
      accountType: 'contest',
      liveTradingConfirmedAt: REAL_TIMESTAMP,
      allowDemoRealExecution: true,
    }),
    'paper'
  );
});

test('E1: real + bypass true → still real', () => {
  assert.equal(
    resolveExecutionMode({
      realTradingEnabled: true,
      accountType: 'real',
      liveTradingConfirmedAt: REAL_TIMESTAMP,
      allowDemoRealExecution: true,
    }),
    'real'
  );
});

test('E1: demo + bypass true but kill switch off → paper', () => {
  assert.equal(
    resolveExecutionMode({
      realTradingEnabled: false,
      accountType: 'demo',
      liveTradingConfirmedAt: REAL_TIMESTAMP,
      allowDemoRealExecution: true,
    }),
    'paper'
  );
});

test('E1: demo + bypass true but confirmation missing → paper', () => {
  assert.equal(
    resolveExecutionMode({
      realTradingEnabled: true,
      accountType: 'demo',
      liveTradingConfirmedAt: null,
      allowDemoRealExecution: true,
    }),
    'paper'
  );
});

for (const badBypass of [undefined, null, 'true', 1, 'yes', 'True']) {
  test(`E1: allowDemoRealExecution=${JSON.stringify(badBypass)} is not literal true → demo stays paper`, () => {
    assert.equal(
      resolveExecutionMode({
        realTradingEnabled: true,
        accountType: 'demo',
        liveTradingConfirmedAt: REAL_TIMESTAMP,
        allowDemoRealExecution: badBypass,
      }),
      'paper'
    );
  });
}

// The load-bearing safety invariant: resolveExecutionMode answering
// 'real' for a demo account under E1 must not be mistakable for a
// Layer 0 account type. resolveExpectedAccountTypeForLayer0 always
// returns the detected type unchanged — callers pass that to placeOrder.
test('E1 invariant: Layer 0 expectedAccountType stays the true detected type, never "real" from dispatch', () => {
  const detectedAccountType = 'demo';
  const mode = resolveExecutionMode({
    realTradingEnabled: true,
    accountType: detectedAccountType,
    liveTradingConfirmedAt: REAL_TIMESTAMP,
    allowDemoRealExecution: true,
  });
  assert.equal(mode, 'real', 'dispatch mode');
  const forLayer0 = resolveExpectedAccountTypeForLayer0(detectedAccountType);
  assert.equal(forLayer0, 'demo');
  assert.notEqual(forLayer0, mode, 'Layer 0 type must not equal the dispatch mode string by coincidence of reuse');
});

test('resolveExpectedAccountTypeForLayer0 is identity for real/demo/contest', () => {
  assert.equal(resolveExpectedAccountTypeForLayer0('real'), 'real');
  assert.equal(resolveExpectedAccountTypeForLayer0('demo'), 'demo');
  assert.equal(resolveExpectedAccountTypeForLayer0('contest'), 'contest');
});
