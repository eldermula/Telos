'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeImpact, normalizeCalendarEvent, normalizeCalendarFeed } = require('../src/calendarMapping');

test('normalizeImpact upper-cases Low/Medium/High', () => {
  assert.equal(normalizeImpact('Low'), 'LOW');
  assert.equal(normalizeImpact('Medium'), 'MEDIUM');
  assert.equal(normalizeImpact('High'), 'HIGH');
});

test('normalizeImpact treats non-economic/holiday rows as LOW, not an error', () => {
  assert.equal(normalizeImpact('Holiday'), 'LOW');
  assert.equal(normalizeImpact(''), 'LOW');
  assert.equal(normalizeImpact(undefined), 'LOW');
});

test('normalizeCalendarEvent resolves a USD event to all six watchlist instruments', () => {
  const event = normalizeCalendarEvent({
    title: 'ISM Manufacturing PMI',
    country: 'USD',
    date: '2026-08-03T10:00:00-04:00',
    impact: 'High',
    forecast: '54.0',
    previous: '53.3',
  });
  assert.equal(event.title, 'ISM Manufacturing PMI');
  assert.equal(event.currency, 'USD');
  assert.equal(event.impact, 'HIGH');
  assert.deepEqual(event.instruments, ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'XAUUSD']);
});

test('normalizeCalendarEvent resolves a JPY event to only USDJPY', () => {
  const event = normalizeCalendarEvent({ title: 'BoJ Rate Decision', country: 'JPY', impact: 'High' });
  assert.deepEqual(event.instruments, ['USDJPY']);
});

test('normalizeCalendarEvent resolves country "All" to an empty instrument list, not an error', () => {
  const event = normalizeCalendarEvent({ title: 'OPEC-JMMC Meetings', country: 'All', impact: 'Medium' });
  assert.deepEqual(event.instruments, []);
});

test('normalizeCalendarEvent rejects a non-object row', () => {
  assert.throws(() => normalizeCalendarEvent(null), TypeError);
  assert.throws(() => normalizeCalendarEvent('not an event'), TypeError);
});

test('normalizeCalendarFeed maps a whole raw feed array', () => {
  const events = normalizeCalendarFeed([
    { title: 'A', country: 'USD', impact: 'High' },
    { title: 'B', country: 'EUR', impact: 'Low' },
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0].currency, 'USD');
  assert.equal(events[1].currency, 'EUR');
});
