'use strict';

/**
 * One-shot FX open probe for E.8 scheduling. Exit 0 always.
 * stdout: JSON { ok, closed, reason, tick_time? }
 */
const path = require('path');
require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', 'backend', '.env'),
});
const {
  assessMarketClosed,
  DEFAULT_MAX_TICK_AGE_SEC,
} = require('../backend/scripts/test-helpers/market-closed-preflight');

const timer = setTimeout(() => {
  process.stdout.write(
    JSON.stringify({ ok: false, closed: true, reason: 'probe_timeout_12s' })
  );
  process.exit(0);
}, 12000);

(async () => {
  try {
    const mt5 = require('../backend/src/services/mt5-connector.client');
    const info = await mt5.getSymbolInfo(process.env.MT5_SMOKE_SYMBOL || 'EURUSD');
    const m = assessMarketClosed(info, { maxTickAgeSec: DEFAULT_MAX_TICK_AGE_SEC });
    clearTimeout(timer);
    process.stdout.write(
      JSON.stringify({
        ok: true,
        closed: m.closed,
        reason: m.reason,
        tick_time: info.tick_time,
      })
    );
  } catch (e) {
    clearTimeout(timer);
    process.stdout.write(
      JSON.stringify({ ok: false, closed: true, reason: String(e.message || e) })
    );
  }
  process.exit(0);
})();
