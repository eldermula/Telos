'use strict';

/**
 * Option 2 E.3 — risked-dollar amount → MT5 lot size for real orders.
 *
 * Sizes off equity (approved): with the current one-position constraint
 * this coincides with balance most of the time, and only diverges if
 * concurrent positions are ever revisited.
 *
 * Contract-size model: for forex, 1.0 lot ≈ 100_000 units of base;
 * pip value approximation uses symbolInfo when available. Until Module 7
 * ships full per-instrument pip-value tables, we use:
 *   lots = riskedDollars / (stopDistancePrice * contractSizePerLot)
 * where contractSizePerLot defaults to 100000 for FX pairs, overridden
 * by symbolInfo.trade_contract_size when the connector provides it.
 *
 * Always clamped to [volume_min, min(volume_max, REAL_MAX_LOT)] and
 * rounded down to volume_step so we never exceed the risked amount by
 * rounding up.
 */

const DEFAULT_FX_CONTRACT_SIZE = 100000;

function roundDownToStep(value, step) {
  if (!step || step <= 0) return value;
  const steps = Math.floor(value / step + 1e-12);
  return Number((steps * step).toFixed(8));
}

/**
 * @param {object} args
 * @param {number} args.equity - live MT5 equity (sizing basis)
 * @param {number} args.appliedRisk - fraction of equity risked (0–1)
 * @param {number} args.entryPrice
 * @param {number} args.stopPrice
 * @param {object} args.symbolInfo - from getSymbolInfo (volume_min/step/max, trade_contract_size?)
 * @param {number} args.maxLot - hard ceiling (REAL_MAX_LOT)
 * @returns {{ lotSize: number, riskedDollars: number, stopDistance: number, cappedBy: string|null }}
 */
function computeRealLotSize({
  equity,
  appliedRisk,
  entryPrice,
  stopPrice,
  symbolInfo,
  maxLot,
}) {
  const eq = Number(equity);
  const risk = Number(appliedRisk);
  const entry = Number(entryPrice);
  const stop = Number(stopPrice);
  const ceiling = Number(maxLot);

  if (!(eq > 0) || !(risk > 0) || !(ceiling > 0)) {
    throw new Error('computeRealLotSize: equity, appliedRisk, and maxLot must be positive');
  }

  const stopDistance = Math.abs(entry - stop);
  if (!(stopDistance > 0)) {
    throw new Error('computeRealLotSize: stopDistance must be positive');
  }

  const volumeMin = Number(symbolInfo.volume_min) || 0.01;
  const volumeStep = Number(symbolInfo.volume_step) || 0.01;
  const volumeMax = Number(symbolInfo.volume_max) || ceiling;
  const contractSize =
    Number(symbolInfo.trade_contract_size) > 0
      ? Number(symbolInfo.trade_contract_size)
      : DEFAULT_FX_CONTRACT_SIZE;

  const riskedDollars = eq * risk;
  // PnL ≈ lots * contractSize * priceMove — so lots ≈ risked / (contractSize * stopDistance)
  let rawLots = riskedDollars / (contractSize * stopDistance);

  let cappedBy = null;
  const hardMax = Math.min(volumeMax, ceiling);
  if (rawLots > hardMax) {
    rawLots = hardMax;
    cappedBy = hardMax === ceiling ? 'REAL_MAX_LOT' : 'volume_max';
  }

  let lotSize = roundDownToStep(rawLots, volumeStep);
  if (lotSize < volumeMin) {
    // Cannot place a size that respects both min lot and risked dollars
    // without exceeding risk — fail closed rather than upsizing.
    throw new Error(
      `computeRealLotSize: computed lot ${lotSize} is below volume_min ${volumeMin}`
    );
  }

  return { lotSize, riskedDollars, stopDistance, cappedBy };
}

module.exports = {
  computeRealLotSize,
  roundDownToStep,
  DEFAULT_FX_CONTRACT_SIZE,
};
