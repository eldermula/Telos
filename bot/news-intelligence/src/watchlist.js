'use strict';

/**
 * 08_Bot_Architecture.md Section 9.0's confirmed watchlist. Kept as one
 * literal source of truth for Module 3's currency->instrument mapping;
 * if the watchlist ever changes, this is the one place that needs to
 * change with it (plus Section 9.0 itself and Module 7's per-instrument
 * execution specs).
 */
const WATCHLIST = Object.freeze(['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'XAUUSD']);

/**
 * Which watchlist instruments a given calendar-event/headline currency
 * is relevant to. USD maps to all six — it's a leg in 5 of 6 pairs, and
 * gold (XAUUSD) is USD-denominated so USD-moving events move it too.
 * A currency with no watchlist exposure (e.g. CNY, CHF, NZD) maps to
 * an empty array, not an error — most calendar events genuinely don't
 * concern any watchlist instrument, and that's a legitimate outcome.
 */
const CURRENCY_TO_INSTRUMENTS = Object.freeze({
  USD: ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'XAUUSD'],
  EUR: ['EURUSD'],
  GBP: ['GBPUSD'],
  JPY: ['USDJPY'],
  AUD: ['AUDUSD'],
  CAD: ['USDCAD'],
});

function instrumentsForCurrency(currencyCode) {
  if (!currencyCode) return [];
  return CURRENCY_TO_INSTRUMENTS[currencyCode.toUpperCase()] || [];
}

module.exports = { WATCHLIST, CURRENCY_TO_INSTRUMENTS, instrumentsForCurrency };
