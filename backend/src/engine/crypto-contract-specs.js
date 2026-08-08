'use strict';

/**
 * Crypto Increment D — normalize MT5 /symbol-info into sizing inputs for
 * BTC/ETH CFDs. Does not place orders. Does not edit bot-runtime.js.
 *
 * When trade_contract_size is missing (older connector), callers must
 * treat sizing as unavailable for crypto rather than silently using the
 * FX default of 100_000 — that default is wrong for most crypto CFDs.
 */

const CRYPTO_SYMBOLS = Object.freeze(['BTCUSD', 'ETHUSD']);

function isCryptoSymbol(symbol) {
  return CRYPTO_SYMBOLS.includes(String(symbol || '').toUpperCase());
}

/**
 * @param {object} symbolInfo raw getSymbolInfo body
 * @returns {{
 *   symbol: string,
 *   volume_min: number,
 *   volume_max: number,
 *   volume_step: number,
 *   trade_contract_size: number|null,
 *   digits: number|null,
 *   point: number|null,
 *   sizingReady: boolean,
 *   reason?: string,
 * }}
 */
function normalizeCryptoContractSpec(symbolInfo) {
  if (!symbolInfo || typeof symbolInfo !== 'object') {
    throw new TypeError('normalizeCryptoContractSpec requires a symbolInfo object');
  }
  const symbol = String(symbolInfo.symbol || '').toUpperCase();
  if (!isCryptoSymbol(symbol)) {
    throw new RangeError(`normalizeCryptoContractSpec: unsupported symbol ${symbolInfo.symbol}`);
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
        'trade_contract_size missing — refuse FX 100000 default for crypto (connector must expose trade_contract_size)',
    };
  }

  return { ...base, sizingReady: true };
}

/**
 * Build the symbolInfo object computeRealLotSize expects, or throw if
 * the crypto spec is not sizing-ready.
 */
function toRealLotSizingSymbolInfo(normalized) {
  if (!normalized || !normalized.sizingReady) {
    throw new Error(
      `crypto contract spec not sizing-ready: ${normalized && normalized.reason ? normalized.reason : 'unknown'}`
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
  CRYPTO_SYMBOLS,
  isCryptoSymbol,
  normalizeCryptoContractSpec,
  toRealLotSizingSymbolInfo,
};
