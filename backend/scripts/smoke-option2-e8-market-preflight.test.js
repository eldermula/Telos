/**
 * Unit coverage for E.8 market-closed preflight (tick staleness).
 * Does not touch MT5 — live skip is proven by the smoke itself.
 */
const assert = require('assert');
const {
  assessMarketClosed,
  DEFAULT_MAX_TICK_AGE_SEC,
} = require('./test-helpers/market-closed-preflight');

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

assert.strictEqual(assessMarketClosed({ trade_mode_full: false }).closed, true);
assert.strictEqual(
  assessMarketClosed({ trade_mode_full: true, bid: 0, ask: 1.1, tick_time: nowSec() }).closed,
  true
);
assert.strictEqual(
  assessMarketClosed({
    trade_mode_full: true,
    bid: 1.1,
    ask: 1.1,
    tick_time: nowSec() - (DEFAULT_MAX_TICK_AGE_SEC + 1),
  }).closed,
  true,
  'stale tick must skip'
);
assert.strictEqual(
  assessMarketClosed({
    trade_mode_full: true,
    bid: 1.1,
    ask: 1.1,
    tick_time: nowSec() - 30,
  }).closed,
  false,
  'fresh tick must allow'
);
assert.strictEqual(
  assessMarketClosed({ trade_mode_full: true, bid: 1.1, ask: 1.1, tick_time: null }).closed,
  true
);

console.log('OPTION2_E8_MARKET_PREFLIGHT_UNIT_PASS');
