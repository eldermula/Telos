'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isConnectionFresh } = require('./connection-freshness');

const NOW = new Date('2026-08-08T12:00:00.000Z');
const HOURS = 24;

test('validated just now → fresh', () => {
  assert.equal(isConnectionFresh(NOW, HOURS, NOW), true);
});

test('validated 23 hours ago → fresh', () => {
  const at = new Date(NOW.getTime() - 23 * 60 * 60 * 1000);
  assert.equal(isConnectionFresh(at, HOURS, NOW), true);
});

test('validated exactly 24 hours ago → fresh (inclusive)', () => {
  const at = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
  assert.equal(isConnectionFresh(at, HOURS, NOW), true);
});

test('validated 25 hours ago → stale', () => {
  const at = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
  assert.equal(isConnectionFresh(at, HOURS, NOW), false);
});

test('null / undefined / empty → not fresh', () => {
  assert.equal(isConnectionFresh(null, HOURS, NOW), false);
  assert.equal(isConnectionFresh(undefined, HOURS, NOW), false);
  assert.equal(isConnectionFresh('', HOURS, NOW), false);
});

test('unparseable → not fresh', () => {
  assert.equal(isConnectionFresh('not-a-date', HOURS, NOW), false);
});

test('future timestamp → not fresh (fail closed)', () => {
  const future = new Date(NOW.getTime() + 60 * 1000);
  assert.equal(isConnectionFresh(future, HOURS, NOW), false);
});

test('accepts ISO string', () => {
  const at = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
  assert.equal(isConnectionFresh(at, HOURS, NOW), true);
});
