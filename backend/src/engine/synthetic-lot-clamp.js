'use strict';

/**
 * Synthetics Batch 2 — clamp a calculated lot size to broker volume_*
 * constraints from /symbol-info.
 *
 * Never rounds *up* past risked exposure: if the step-rounded size is
 * below volume_min, skip the trade rather than forcing volume_min.
 */

function roundToStep(value, step) {
  if (!step || !(step > 0)) return value;
  const steps = Math.round(value / step);
  return Number((steps * step).toFixed(8));
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
  clampLotSize,
  roundToStep,
};
