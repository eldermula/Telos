'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  LIVE_TRADING_CONFIRMATION_TTL_MINUTES,
  isConfirmationActive,
} = require('./live-trading-confirmation');

const NOW = new Date('2026-08-08T12:00:00.000Z');
const TTL_MS = LIVE_TRADING_CONFIRMATION_TTL_MINUTES * 60 * 1000;

test('a confirmation from this instant is active', () => {
  assert.equal(isConfirmationActive(NOW, NOW), true);
});

test('a confirmation just under the TTL boundary is still active', () => {
  const confirmedAt = new Date(NOW.getTime() - (TTL_MS - 1000));
  assert.equal(isConfirmationActive(confirmedAt, NOW), true);
});

test('a confirmation exactly at the TTL boundary is still active (inclusive)', () => {
  const confirmedAt = new Date(NOW.getTime() - TTL_MS);
  assert.equal(isConfirmationActive(confirmedAt, NOW), true);
});

test('a confirmation one second past the TTL boundary is expired', () => {
  const confirmedAt = new Date(NOW.getTime() - TTL_MS - 1000);
  assert.equal(isConfirmationActive(confirmedAt, NOW), false);
});

test('a confirmation from a week ago is expired', () => {
  const confirmedAt = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
  assert.equal(isConfirmationActive(confirmedAt, NOW), false);
});

test('accepts an ISO string, not just a Date instance', () => {
  const confirmedAt = new Date(NOW.getTime() - 60 * 1000).toISOString();
  assert.equal(isConfirmationActive(confirmedAt, NOW), true);
});

test('null -> not active', () => {
  assert.equal(isConfirmationActive(null, NOW), false);
});

test('undefined -> not active', () => {
  assert.equal(isConfirmationActive(undefined, NOW), false);
});

test('empty string -> not active', () => {
  assert.equal(isConfirmationActive('', NOW), false);
});

test('unparseable string -> not active, does not throw', () => {
  assert.doesNotThrow(() => isConfirmationActive('not-a-date', NOW));
  assert.equal(isConfirmationActive('not-a-date', NOW), false);
});

test('a timestamp in the future (clock skew / corrupt data) -> not active, fails closed', () => {
  const confirmedAt = new Date(NOW.getTime() + 60 * 1000);
  assert.equal(isConfirmationActive(confirmedAt, NOW), false);
});

test('defaults `now` to the current time when omitted', () => {
  const confirmedAt = new Date();
  assert.equal(isConfirmationActive(confirmedAt), true);
});
