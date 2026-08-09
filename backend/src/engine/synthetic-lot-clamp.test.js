'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { clampLotSize } = require('./synthetic-lot-clamp');

/** Live Deriv-Demo profiles from Batch diagnostics. */
const PROFILES = {
  'Volatility 25 Index': { volume_min: 0.5, volume_max: 400.0, volume_step: 0.01 },
  'Volatility 50 Index': { volume_min: 4.0, volume_max: 3700.0, volume_step: 0.01 },
  'Volatility 75 Index': { volume_min: 0.01, volume_max: 15.0, volume_step: 0.001 },
};

describe('clampLotSize', () => {
  it('skips when below volume_min (Volatility 25 — paper 0.001 style)', () => {
    const r = clampLotSize(0.001, PROFILES['Volatility 25 Index']);
    assert.deepEqual(r, { size: null, skipped: true, reason: 'below_volume_min' });
  });

  it('skips when below volume_min (Volatility 50 — 0.5 < 4.0)', () => {
    const r = clampLotSize(0.5, PROFILES['Volatility 50 Index']);
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'below_volume_min');
    assert.equal(r.size, null);
  });

  it('accepts exact volume_min after step round (Volatility 25)', () => {
    const r = clampLotSize(0.5, PROFILES['Volatility 25 Index']);
    assert.equal(r.skipped, false);
    assert.equal(r.reason, null);
    assert.equal(r.size, 0.5);
  });

  it('rounds to nearest volume_step (Volatility 75 step 0.001)', () => {
    const r = clampLotSize(0.0124, PROFILES['Volatility 75 Index']);
    assert.equal(r.skipped, false);
    assert.equal(r.reason, null);
    assert.equal(r.size, 0.012);
  });

  it('clamps down to volume_max (Volatility 75)', () => {
    const r = clampLotSize(20, PROFILES['Volatility 75 Index']);
    assert.equal(r.skipped, false);
    assert.equal(r.reason, 'clamped_to_volume_max');
    assert.equal(r.size, 15);
  });

  it('clamps down to volume_max (Volatility 50)', () => {
    const r = clampLotSize(5000, PROFILES['Volatility 50 Index']);
    assert.equal(r.skipped, false);
    assert.equal(r.reason, 'clamped_to_volume_max');
    assert.equal(r.size, 3700);
  });

  it('never forces size up to volume_min when undersized (Volatility 25)', () => {
    const r = clampLotSize(0.49, PROFILES['Volatility 25 Index']);
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'below_volume_min');
    assert.equal(r.size, null);
  });
});
