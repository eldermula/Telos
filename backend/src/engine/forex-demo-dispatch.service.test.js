'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toStatus, MAX_ENABLE_MINUTES } = require('./forex-demo-dispatch.service');

test('toStatus: null → disabled', () => {
  const s = toStatus(null);
  assert.equal(s.enabled, false);
  assert.equal(s.enabled_until, null);
  assert.equal(s.remaining_seconds, 0);
});

test('toStatus: past timestamp → disabled', () => {
  const s = toStatus(new Date(Date.now() - 60_000).toISOString());
  assert.equal(s.enabled, false);
  assert.equal(s.remaining_seconds, 0);
});

test('toStatus: future timestamp → enabled with remaining', () => {
  const until = new Date(Date.now() + 90_000).toISOString();
  const s = toStatus(until);
  assert.equal(s.enabled, true);
  assert.equal(s.enabled_until, until);
  assert.ok(s.remaining_seconds >= 89 && s.remaining_seconds <= 91);
});

test('MAX_ENABLE_MINUTES is 30', () => {
  assert.equal(MAX_ENABLE_MINUTES, 30);
});
