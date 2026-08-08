'use strict';

/**
 * Synthetics first-cut watchlist — continuous Volatility Indices only
 * (docs/13_Synthetics_Probe_Report.md §6). Exact MT5 names; spaces matter.
 * Boom/Crash/Jump and (1s)/HF variants are out of scope for this pass.
 */
const SYNTHETIC_WATCHLIST = Object.freeze([
  'Volatility 10 Index',
  'Volatility 25 Index',
  'Volatility 50 Index',
  'Volatility 75 Index',
  'Volatility 100 Index',
]);

function isSyntheticWatchlistSymbol(symbol) {
  const s = String(symbol || '');
  return SYNTHETIC_WATCHLIST.some((name) => name.toLowerCase() === s.toLowerCase());
}

/** Resolve any casing variant to the canonical MT5 name, or null. */
function canonicalSyntheticSymbol(symbol) {
  const s = String(symbol || '');
  return SYNTHETIC_WATCHLIST.find((name) => name.toLowerCase() === s.toLowerCase()) || null;
}

module.exports = {
  SYNTHETIC_WATCHLIST,
  isSyntheticWatchlistSymbol,
  canonicalSyntheticSymbol,
};
