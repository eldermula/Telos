'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  clampLotSize,
  computeSyntheticRawLotSize,
} = require('./synthetic-lot-clamp');

/** Live Deriv-Demo profiles from Batch / connector diagnostics. */
const PROFILES = {
  'Volatility 10 Index': {
    volume_min: 0.5,
    volume_max: 400,
    volume_step: 0.01,
    trade_contract_size: 1,
  },
  'Volatility 25 Index': { volume_min: 0.5, volume_max: 400.0, volume_step: 0.01 },
  'Volatility 50 Index': {
    volume_min: 4.0,
    volume_max: 3700.0,
    volume_step: 0.01,
    trade_contract_size: 1,
  },
  'Volatility 75 Index': {
    volume_min: 0.01,
    volume_max: 15.0,
    volume_step: 0.001,
    trade_contract_size: 1,
  },
  'Volatility 100 Index': {
    volume_min: 1,
    volume_max: 220,
    volume_step: 0.01,
    trade_contract_size: 1,
  },
};

describe('computeSyntheticRawLotSize', () => {
  it('Vol 10 @ ~$10k equity / 1% risk / ATR-style stop clears volume_min 0.5', () => {
    const profile = PROFILES['Volatility 10 Index'];
    const raw = computeSyntheticRawLotSize({
      effectiveBalance: 9984.65,
      appliedRisk: 0.01,
      entryPrice: 4815,
      stopPrice: 4815 - 6, // ~1.5×ATR style
      contractSize: profile.trade_contract_size,
    });
    assert.equal(raw.reason, null);
    assert.ok(raw.rawLotSize > 0);
    // 99.8465 / (6 * 1) ≈ 16.64
    assert.ok(Math.abs(raw.rawLotSize - 99.8465 / 6) < 1e-6);
    const clamped = clampLotSize(raw.rawLotSize, profile);
    assert.equal(clamped.skipped, false);
    assert.ok(clamped.size >= profile.volume_min);
  });

  it('Vol 50 @ ~$10k equity / 1% risk clears volume_min 4.0', () => {
    const profile = PROFILES['Volatility 50 Index'];
    const raw = computeSyntheticRawLotSize({
      effectiveBalance: 9984.65,
      appliedRisk: 0.01,
      entryPrice: 100.8,
      stopPrice: 100.8 - 0.5,
      contractSize: profile.trade_contract_size,
    });
    // 99.8465 / 0.5 ≈ 199.7 → well above min 4
    const clamped = clampLotSize(raw.rawLotSize, profile);
    assert.equal(clamped.skipped, false);
    assert.ok(clamped.size >= profile.volume_min);
  });

  it('Vol 75 respects 0.001 step after formula', () => {
    const profile = PROFILES['Volatility 75 Index'];
    const raw = computeSyntheticRawLotSize({
      effectiveBalance: 9984.65,
      appliedRisk: 0.01,
      entryPrice: 51000,
      stopPrice: 51000 - 450,
      contractSize: profile.trade_contract_size,
    });
    const clamped = clampLotSize(raw.rawLotSize, profile);
    assert.equal(clamped.skipped, false);
    // step 0.001 — size should be a multiple of step within float dust
    const steps = clamped.size / profile.volume_step;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-6);
  });

  it('Vol 100 @ live equity clears volume_min 1 (replaces 0.001 placeholder failure)', () => {
    const profile = PROFILES['Volatility 100 Index'];
    const raw = computeSyntheticRawLotSize({
      effectiveBalance: 9984.65,
      appliedRisk: 0.01,
      entryPrice: 623,
      stopPrice: 623 - 8,
      contractSize: profile.trade_contract_size,
    });
    const clamped = clampLotSize(raw.rawLotSize, profile);
    assert.equal(clamped.skipped, false);
    assert.ok(clamped.size >= 1);
  });

  it('genuinely tiny risk still skip-able via clampLotSize (safety valve)', () => {
    const profile = PROFILES['Volatility 10 Index'];
    const raw = computeSyntheticRawLotSize({
      effectiveBalance: 10,
      appliedRisk: 0.01,
      entryPrice: 4815,
      stopPrice: 4815 - 50,
      contractSize: profile.trade_contract_size,
    });
    // dollar_risk=0.1, stop=50 → raw=0.002 << volume_min 0.5
    assert.ok(raw.rawLotSize < profile.volume_min);
    const clamped = clampLotSize(raw.rawLotSize, profile);
    assert.equal(clamped.skipped, true);
    assert.equal(clamped.reason, 'below_volume_min');
  });
});

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
