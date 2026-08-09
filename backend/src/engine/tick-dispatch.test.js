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

test('haltNewOpens with no position → skipOpen (both modes)', () => {
  assert.equal(
    resolveTickDispatch({
      resolvedMode: 'paper',
      openPosition: null,
      haltNewOpens: true,
    }),
    'skipOpen'
  );
  assert.equal(
    resolveTickDispatch({
      resolvedMode: 'real',
      openPosition: null,
      haltNewOpens: true,
    }),
    'skipOpen'
  );
});

test('haltNewOpens with open real position → still monitorReal', () => {
  assert.equal(
    resolveTickDispatch({
      resolvedMode: 'real',
      openPosition: { executionMode: 'real' },
      haltNewOpens: true,
    }),
    'monitorReal'
  );
});

test('haltNewOpens with open paper position → still monitorPaper', () => {
  assert.equal(
    resolveTickDispatch({
      resolvedMode: 'paper',
      openPosition: { executionMode: 'paper' },
      haltNewOpens: true,
    }),
    'monitorPaper'
  );
});

test('full matrix covers open/monitor targets plus skipOpen', () => {
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
    seen.add(
      resolveTickDispatch({
        resolvedMode: mode,
        openPosition: null,
        haltNewOpens: true,
      })
    );
  }
  assert.deepEqual(
    [...seen].sort(),
    ['monitorPaper', 'monitorReal', 'openPaper', 'openReal', 'skipOpen'].sort()
  );
});
