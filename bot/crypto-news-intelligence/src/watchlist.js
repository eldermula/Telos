'use strict';

/**
 * Crypto watchlist — BTC/ETH only (docs/11_Crypto_Synthetics_Scoping.md §6).
 * Symbols are MT5-style USD-quoted CFDs; broker-specific aliases (BTCUSDT,
 * etc.) are a later Module 7 / connector concern, not this package's job.
 */
const CRYPTO_WATCHLIST = Object.freeze(['BTCUSD', 'ETHUSD']);

const ENTITY_TO_INSTRUMENTS = Object.freeze({
  BTC: Object.freeze(['BTCUSD']),
  ETH: Object.freeze(['ETHUSD']),
  // Broad "crypto risk" tag — fans to both when a headline moves the
  // complex without naming a single coin (ETF basket, exchange outage).
  CRYPTO: Object.freeze(['BTCUSD', 'ETHUSD']),
});

function instrumentsForEntity(entity) {
  const tag = String(entity || '').trim().toUpperCase();
  return ENTITY_TO_INSTRUMENTS[tag] ? [...ENTITY_TO_INSTRUMENTS[tag]] : [];
}

module.exports = {
  CRYPTO_WATCHLIST,
  ENTITY_TO_INSTRUMENTS,
  instrumentsForEntity,
};
