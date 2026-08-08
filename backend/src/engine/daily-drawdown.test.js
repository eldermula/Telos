'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  utcDayKey,
  computeDailyDrawdownPct,
  nextDailyDrawdownMarkers,
  shrinkDailyDrawdownMarkersForProfitLock,
} = require('./daily-drawdown');

describe('utcDayKey', () => {
  it('formats UTC calendar day', () => {
    assert.equal(utcDayKey(new Date('2026-08-11T01:30:00.000Z')), '2026-08-11');
    assert.equal(utcDayKey(new Date('2026-08-11T23:59:59.999Z')), '2026-08-11');
  });
});

describe('computeDailyDrawdownPct', () => {
  it('returns 0 when at or above peak', () => {
    assert.equal(computeDailyDrawdownPct({ currentEquity: 100, dayPeakEquity: 100 }), 0);
    assert.equal(computeDailyDrawdownPct({ currentEquity: 110, dayPeakEquity: 100 }), 0);
  });

  it('returns fraction down from peak', () => {
    assert.equal(computeDailyDrawdownPct({ currentEquity: 85, dayPeakEquity: 100 }), 0.15);
    assert.equal(computeDailyDrawdownPct({ currentEquity: 80, dayPeakEquity: 100 }), 0.2);
  });

  it('returns 0 for non-positive peak', () => {
    assert.equal(computeDailyDrawdownPct({ currentEquity: 10, dayPeakEquity: 0 }), 0);
  });
});

describe('nextDailyDrawdownMarkers', () => {
  it('initializes on null markers (first tick)', () => {
    const r = nextDailyDrawdownMarkers({
      now: new Date('2026-08-11T12:00:00.000Z'),
      currentEquity: 1000,
      markers: null,
    });
    assert.equal(r.rolledOver, true);
    assert.deepEqual(r.markers, {
      day: '2026-08-11',
      startEquity: 1000,
      peakEquity: 1000,
    });
    assert.equal(r.dailyDrawdownPct, 0);
  });

  it('rolls over on new UTC day', () => {
    const r = nextDailyDrawdownMarkers({
      now: new Date('2026-08-12T00:00:00.000Z'),
      currentEquity: 900,
      markers: { day: '2026-08-11', startEquity: 1000, peakEquity: 1100 },
    });
    assert.equal(r.rolledOver, true);
    assert.deepEqual(r.markers, {
      day: '2026-08-12',
      startEquity: 900,
      peakEquity: 900,
    });
    assert.equal(r.dailyDrawdownPct, 0);
  });

  it('raises peak and reports drawdown from peak-of-day', () => {
    const up = nextDailyDrawdownMarkers({
      now: new Date('2026-08-11T10:00:00.000Z'),
      currentEquity: 1200,
      markers: { day: '2026-08-11', startEquity: 1000, peakEquity: 1000 },
    });
    assert.equal(up.rolledOver, false);
    assert.equal(up.markers.peakEquity, 1200);
    assert.equal(up.dailyDrawdownPct, 0);

    const down = nextDailyDrawdownMarkers({
      now: new Date('2026-08-11T11:00:00.000Z'),
      currentEquity: 1020,
      markers: up.markers,
    });
    assert.equal(down.markers.peakEquity, 1200);
    assert.equal(down.dailyDrawdownPct, (1200 - 1020) / 1200);
    assert.ok(down.dailyDrawdownPct >= 0.15);
  });
});

describe('shrinkDailyDrawdownMarkersForProfitLock', () => {
  it('subtracts locked amount from start and peak, floored at current equity', () => {
    // current 850: start/peak both stay at (value - lock); floor does not bind
    const next = shrinkDailyDrawdownMarkersForProfitLock({
      markers: { day: '2026-08-11', startEquity: 1000, peakEquity: 1200 },
      lockedProfitAmount: 100,
      currentEquity: 850,
    });
    assert.deepEqual(next, {
      day: '2026-08-11',
      startEquity: 900,
      peakEquity: 1100,
    });
  });

  it('floors shrink at current equity so lock cannot invent drawdown', () => {
    const next = shrinkDailyDrawdownMarkersForProfitLock({
      markers: { day: '2026-08-11', startEquity: 1000, peakEquity: 1000 },
      lockedProfitAmount: 200,
      currentEquity: 900,
    });
    // 1000 - 200 = 800, but floor at current 900
    assert.equal(next.startEquity, 900);
    assert.equal(next.peakEquity, 900);
    assert.equal(
      computeDailyDrawdownPct({
        currentEquity: 900,
        dayPeakEquity: next.peakEquity,
      }),
      0
    );
  });

  it('no-ops on missing markers or non-positive lock', () => {
    assert.equal(
      shrinkDailyDrawdownMarkersForProfitLock({
        markers: null,
        lockedProfitAmount: 50,
        currentEquity: 100,
      }),
      null
    );
    const markers = { day: '2026-08-11', startEquity: 100, peakEquity: 100 };
    assert.equal(
      shrinkDailyDrawdownMarkersForProfitLock({
        markers,
        lockedProfitAmount: 0,
        currentEquity: 100,
      }),
      markers
    );
  });
});
