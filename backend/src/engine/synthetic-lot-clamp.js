'use strict';

/**
 * Synthetics lot sizing — risked dollars → raw lots, then broker clamp.
 *
 * Formula (replaces the Phase-6 `appliedRisk * 0.1` placeholder):
 *   stop_distance = |entry - stop|
 *   dollar_risk   = effective_balance * applied_risk  (fraction 0–1)
 *   raw_lot_size  = dollar_risk / (stop_distance * contract_size)
 * then clampLotSize(raw, symbolInfo) — never upsizes below volume_min.
 */

function roundToStep(value, step) {
  if (!step || !(step > 0)) return value;
  const steps = Math.round(value / step);
  return Number((steps * step).toFixed(8));
}

/**
 * @param {object} args
 * @param {number} args.effectiveBalance - live equity (real) or synthetic ledger (paper)
 * @param {number} args.appliedRisk - fraction of balance risked (0–1)
 * @param {number} args.entryPrice
 * @param {number} args.stopPrice
 * @param {number} args.contractSize - trade_contract_size from /symbol-info
 * @returns {{
 *   rawLotSize: number|null,
 *   stopDistance: number|null,
 *   dollarRisk: number|null,
 *   reason: string|null
 * }}
 */
function computeSyntheticRawLotSize({
  effectiveBalance,
  appliedRisk,
  entryPrice,
  stopPrice,
  contractSize,
}) {
  const balance = Number(effectiveBalance);
  const risk = Number(appliedRisk);
  const entry = Number(entryPrice);
  const stop = Number(stopPrice);
  const cs = Number(contractSize);

  if (!(balance > 0) || !(risk > 0) || !(cs > 0)) {
    return {
      rawLotSize: null,
      stopDistance: null,
      dollarRisk: null,
      reason: 'invalid_inputs',
    };
  }

  const stopDistance = Math.abs(entry - stop);
  if (!(stopDistance > 0)) {
    return {
      rawLotSize: null,
      stopDistance: 0,
      dollarRisk: balance * risk,
      reason: 'zero_stop_distance',
    };
  }

  const dollarRisk = balance * risk;
  const rawLotSize = dollarRisk / (stopDistance * cs);
  if (!(rawLotSize > 0) || !Number.isFinite(rawLotSize)) {
    return {
      rawLotSize: null,
      stopDistance,
      dollarRisk,
      reason: 'invalid_raw_lot',
    };
  }

  return { rawLotSize, stopDistance, dollarRisk, reason: null };
}

/**
 * @param {number} calculatedSize
 * @param {{ volume_min?: number, volume_step?: number, volume_max?: number }} symbolInfo
 * @returns {{ size: number|null, skipped: boolean, reason: string|null }}
 */
function clampLotSize(calculatedSize, symbolInfo) {
  const raw = Number(calculatedSize);
  const volumeMin = Number(symbolInfo && symbolInfo.volume_min);
  const volumeStep = Number(symbolInfo && symbolInfo.volume_step);
  const volumeMax = Number(symbolInfo && symbolInfo.volume_max);

  if (!(raw > 0) || !Number.isFinite(raw)) {
    return { size: null, skipped: true, reason: 'below_volume_min' };
  }
  if (!(volumeMin > 0) || !(volumeStep > 0) || !(volumeMax > 0)) {
    return { size: null, skipped: true, reason: 'below_volume_min' };
  }

  let rounded = roundToStep(raw, volumeStep);
  // Avoid floating dust that lands microscopically below a step multiple.
  if (rounded < volumeMin && Math.abs(rounded - volumeMin) < volumeStep * 1e-9) {
    rounded = volumeMin;
  }

  if (rounded < volumeMin) {
    return { size: null, skipped: true, reason: 'below_volume_min' };
  }

  if (rounded > volumeMax) {
    const capped = roundToStep(volumeMax, volumeStep);
    const size = capped > volumeMax ? roundToStep(volumeMax - volumeStep, volumeStep) : capped;
    const finalSize = size >= volumeMin ? Math.min(size, volumeMax) : volumeMax;
    return {
      size: Number(finalSize.toFixed(8)),
      skipped: false,
      reason: 'clamped_to_volume_max',
    };
  }

  return { size: Number(rounded.toFixed(8)), skipped: false, reason: null };
}

module.exports = {
  computeSyntheticRawLotSize,
  clampLotSize,
  roundToStep,
};
