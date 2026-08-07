'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveTickDispatch } = require('./tick-dispatch');

test('no open position + paper mode → openPaper', () => {
  assert.equal(resolveTickDispatch({ resolvedMode: 'paper', openPosition: null }), 'openPaper');
});

test('no open position + real mode → openReal', () => {
  assert.equal(resolveTickDispatch({ resolvedMode: 'real', openPosition: null }), 'openReal');
});

test('open paper position + this-tick real mode → still monitorPaper (frozen)', () => {
  assert.equal(
    resolveTickDispatch({
      resolvedMode: 'real',
      openPosition: { executionMode: 'paper' },
    }),
    'monitorPaper'
  );
});

test('open real position + this-tick paper mode → still monitorReal (frozen)', () => {
  assert.equal(
    resolveTickDispatch({
      resolvedMode: 'paper',
      openPosition: { executionMode: 'real' },
    }),
    'monitorReal'
  );
});

test('open position without executionMode defaults to paper monitor', () => {
  assert.equal(
    resolveTickDispatch({ resolvedMode: 'real', openPosition: { tradeRowId: 'x' } }),
    'monitorPaper'
  );
});

test('full matrix covers all four dispatch targets', () => {
  const seen = new Set();
  for (const mode of ['paper', 'real']) {
    seen.add(resolveTickDispatch({ resolvedMode: mode, openPosition: null }));
    seen.add(
      resolveTickDispatch({
        resolvedMode: mode,
        openPosition: { executionMode: 'paper' },
      })
    );
    seen.add(
      resolveTickDispatch({
        resolvedMode: mode,
        openPosition: { executionMode: 'real' },
      })
    );
  }
  assert.deepEqual(
    [...seen].sort(),
    ['monitorPaper', 'monitorReal', 'openPaper', 'openReal'].sort()
  );
});
