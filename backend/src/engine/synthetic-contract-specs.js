'use strict';

/**
 * Synthetics contract-spec normalizer for Volatility Index CFDs.
 * Does not place orders. Does not edit bot-runtime.js / crypto-bot-runtime.js.
 *
 * Refuses the FX 100000 default when trade_contract_size is missing —
 * same fail-closed discipline as crypto Increment D.
 */

const path = require('path');
const {
  SYNTHETIC_WATCHLIST,
  isSyntheticWatchlistSymbol,
  canonicalSyntheticSymbol,
} = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  'bot',
  'synthetic-market-intelligence',
  'src',
  'watchlist.js'
));

const SYNTHETIC_SYMBOLS = SYNTHETIC_WATCHLIST;

function isSyntheticSymbol(symbol) {
  return isSyntheticWatchlistSymbol(symbol);
}

/**
 * @param {object} symbolInfo raw getSymbolInfo body
 */
function normalizeSyntheticContractSpec(symbolInfo) {
  if (!symbolInfo || typeof symbolInfo !== 'object') {
    throw new TypeError('normalizeSyntheticContractSpec requires a symbolInfo object');
  }
  const symbol = canonicalSyntheticSymbol(symbolInfo.symbol);
  if (!symbol) {
    throw new RangeError(
      `normalizeSyntheticContractSpec: unsupported symbol ${symbolInfo.symbol}`
    );
  }

  const volume_min = Number(symbolInfo.volume_min);
  const volume_max = Number(symbolInfo.volume_max);
  const volume_step = Number(symbolInfo.volume_step);
  const trade_contract_size =
    Number(symbolInfo.trade_contract_size) > 0 ? Number(symbolInfo.trade_contract_size) : null;

  const base = {
    symbol,
    volume_min: Number.isFinite(volume_min) ? volume_min : null,
    volume_max: Number.isFinite(volume_max) ? volume_max : null,
    volume_step: Number.isFinite(volume_step) ? volume_step : null,
    trade_contract_size,
    digits: Number.isFinite(Number(symbolInfo.digits)) ? Number(symbolInfo.digits) : null,
    point: Number.isFinite(Number(symbolInfo.point)) ? Number(symbolInfo.point) : null,
  };

  if (!(base.volume_min > 0) || !(base.volume_step > 0)) {
    return {
      ...base,
      sizingReady: false,
      reason: 'missing volume_min/volume_step from broker symbol_info',
    };
  }
  if (!(base.trade_contract_size > 0)) {
    return {
      ...base,
      sizingReady: false,
      reason:
        'trade_contract_size missing — refuse FX 100000 default for synthetics (connector must expose trade_contract_size)',
    };
  }

  return { ...base, sizingReady: true };
}

function toRealLotSizingSymbolInfo(normalized) {
  if (!normalized || !normalized.sizingReady) {
    throw new Error(
      `synthetic contract spec not sizing-ready: ${
        normalized && normalized.reason ? normalized.reason : 'unknown'
      }`
    );
  }
  return {
    volume_min: normalized.volume_min,
    volume_max: normalized.volume_max,
    volume_step: normalized.volume_step,
    trade_contract_size: normalized.trade_contract_size,
  };
}

module.exports = {
  SYNTHETIC_SYMBOLS,
  isSyntheticSymbol,
  normalizeSyntheticContractSpec,
  toRealLotSizingSymbolInfo,
};
