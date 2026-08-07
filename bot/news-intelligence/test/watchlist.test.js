'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { WATCHLIST, instrumentsForCurrency } = require('../src/watchlist');

test('WATCHLIST matches the six confirmed Section 9.0 instruments', () => {
  assert.deepEqual(WATCHLIST, ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'XAUUSD']);
});

test('USD maps to all six instruments (leg in 5 pairs + gold is USD-denominated)', () => {
  assert.deepEqual(instrumentsForCurrency('USD'), [
    'EURUSD',
    'GBPUSD',
    'USDJPY',
    'AUDUSD',
    'USDCAD',
    'XAUUSD',
  ]);
});

test('EUR/GBP/JPY/AUD/CAD each map to exactly their one pair', () => {
  assert.deepEqual(instrumentsForCurrency('EUR'), ['EURUSD']);
  assert.deepEqual(instrumentsForCurrency('GBP'), ['GBPUSD']);
  assert.deepEqual(instrumentsForCurrency('JPY'), ['USDJPY']);
  assert.deepEqual(instrumentsForCurrency('AUD'), ['AUDUSD']);
  assert.deepEqual(instrumentsForCurrency('CAD'), ['USDCAD']);
});

test('a currency with no watchlist exposure maps to an empty array, not an error', () => {
  assert.deepEqual(instrumentsForCurrency('CHF'), []);
  assert.deepEqual(instrumentsForCurrency('CNY'), []);
});

test('is case-insensitive and handles missing/empty input', () => {
  assert.deepEqual(instrumentsForCurrency('usd'), instrumentsForCurrency('USD'));
  assert.deepEqual(instrumentsForCurrency(null), []);
  assert.deepEqual(instrumentsForCurrency(''), []);
  assert.deepEqual(instrumentsForCurrency('All'), []);
});
