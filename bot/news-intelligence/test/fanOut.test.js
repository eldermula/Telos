'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { fanOutClassification, instrumentsForEntity } = require('../src/fanOut');

test('XAU resolves directly to XAUUSD, not through the currency table', () => {
  assert.deepEqual(instrumentsForEntity('XAU'), ['XAUUSD']);
  assert.deepEqual(instrumentsForEntity('xau'), ['XAUUSD']);
});

test('a normal currency entity resolves via the watchlist currency table', () => {
  assert.deepEqual(instrumentsForEntity('JPY'), ['USDJPY']);
});

test('fans one USD classification out to all six watchlist instruments with the same reading', () => {
  const fanned = fanOutClassification({ entities: ['USD'], sentiment: 0.5, impact: 0.8 });
  assert.equal(fanned.length, 6);
  for (const entry of fanned) {
    assert.equal(entry.sentiment, 0.5);
    assert.equal(entry.impact, 0.8);
  }
  const instruments = fanned.map((f) => f.instrument).sort();
  assert.deepEqual(instruments, ['AUDUSD', 'EURUSD', 'GBPUSD', 'USDCAD', 'USDJPY', 'XAUUSD'].sort());
});

test('multiple entities de-duplicate to a unique instrument set (e.g. USD + XAU both touch XAUUSD once)', () => {
  const fanned = fanOutClassification({ entities: ['USD', 'XAU'], sentiment: -0.3, impact: 0.6 });
  const xauEntries = fanned.filter((f) => f.instrument === 'XAUUSD');
  assert.equal(xauEntries.length, 1, 'XAUUSD should appear exactly once even though two entities resolve to it');
});

test('an entity with no watchlist exposure contributes nothing (empty fan-out)', () => {
  const fanned = fanOutClassification({ entities: ['CHF'], sentiment: 0.9, impact: 0.9 });
  assert.deepEqual(fanned, []);
});

test('rejects a classification with no entities array', () => {
  assert.throws(() => fanOutClassification({ sentiment: 0, impact: 0 }), TypeError);
  assert.throws(() => fanOutClassification(null), TypeError);
});
