/**
 * Phase 4.6a smoke — first real MT5 order-placement path.
 * Standalone: talks directly to the Python connector, no Backend HTTP
 * server, no BotRuntime involvement (4.6b explicitly deferred).
 *
 * Places the connector-reported minimum lot size on EURUSD against the
 * attached MetaQuotes-Demo terminal, verifies the position exists, closes
 * it, verifies it's gone. Aborts cleanly (not a FAIL) if the symbol's
 * trade_mode isn't fully enabled — the connector's own signal that the
 * market is closed (e.g. weekend) rather than a code bug.
 *
 * Updated for Option 2 Increment B: placeOrder/closeOrder now require
 * expectedAccountType (Layer 0 gating — no caller is exempt, including
 * this pre-existing manual path). Round-trips through the new
 * getAccountInfo() to use the connector's own real-time-detected
 * account_type rather than hardcoding 'demo' — proves the new endpoint
 * works with real data, not just that the call signature was updated.
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const mt5Client = require('../src/services/mt5-connector.client');

const SYMBOL = process.env.MT5_SMOKE_SYMBOL || 'EURUSD';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('Fetching real account info from the connector...');
  const account = await mt5Client.getAccountInfo();
  console.log('account_info', {
    login: account.login,
    account_type: account.account_type,
    balance: account.balance,
    equity: account.equity,
    currency: account.currency,
  });
  assert(
    ['demo', 'contest', 'real'].includes(account.account_type),
    `expected a real account_type from the connector, got ${account.account_type}`
  );
  const expectedAccountType = account.account_type;

  console.log(`Checking ${SYMBOL} trading status before placing anything...`);
  const info = await mt5Client.getSymbolInfo(SYMBOL);
  console.log('symbol_info', {
    trade_mode: info.trade_mode,
    trade_mode_full: info.trade_mode_full,
    volume_min: info.volume_min,
    bid: info.bid,
    ask: info.ask,
    tick_time: info.tick_time,
  });

  if (!info.trade_mode_full) {
    console.log(
      `ABORT (not a failure): ${SYMBOL} trade_mode=${info.trade_mode} is not fully enabled — ` +
        `market is likely closed (weekend/holiday). Re-run during market hours.`
    );
    return;
  }

  if (!info.bid || !info.ask) {
    console.log(`ABORT (not a failure): no live tick for ${SYMBOL} — market appears closed.`);
    return;
  }

  const lotSize = info.volume_min;
  assert(lotSize > 0, 'expected a positive volume_min from connector');
  console.log(`Using confirmed minimum lot size: ${lotSize} ${SYMBOL}`);

  console.log(`Placing BUY ${lotSize} ${SYMBOL} (expectedAccountType=${expectedAccountType})...`);
  let placed;
  try {
    placed = await mt5Client.placeOrder({
      symbol: SYMBOL,
      direction: 'BUY',
      volume: lotSize,
      expectedAccountType,
    });
  } catch (err) {
    // trade_mode_full above can still read true in the exact window the
    // session is closing — the broker's order_send retcode is the more
    // authoritative signal right at that boundary. Same "abort cleanly,
    // not a FAIL" treatment as the trade_mode_full check itself.
    if (err.details?.retcode === 10018) {
      console.log('ABORT (not a failure): broker reports Market closed (retcode 10018) at the moment of order_send.');
      return;
    }
    throw err;
  }
  console.log('placed', placed);
  assert(placed.ticket, 'expected a ticket back from order placement');

  await sleep(500);

  let positions = await mt5Client.getPositions(SYMBOL);
  console.log('positions_after_place', positions.map((p) => ({ ticket: p.ticket, volume: p.volume })));
  const openPosition = positions.find((p) => p.ticket === placed.ticket);
  assert(openPosition, `expected ticket ${placed.ticket} to appear in open positions`);
  assert(openPosition.symbol === SYMBOL, 'position symbol mismatch');
  assert(Math.abs(openPosition.volume - lotSize) < 1e-9, 'position volume mismatch');

  console.log(`Closing ticket ${placed.ticket}...`);
  const closed = await mt5Client.closeOrder(placed.ticket, { expectedAccountType });
  console.log('closed', closed);

  await sleep(500);

  positions = await mt5Client.getPositions(SYMBOL);
  const stillOpen = positions.find((p) => p.ticket === placed.ticket);
  assert(!stillOpen, `expected ticket ${placed.ticket} to no longer be open after close`);

  // Increment B's other new capability — close-time reconciliation via
  // history_deals_get. Proves it resolves the real closing deal, not
  // just that the endpoint returns 200 for anything.
  console.log(`Fetching order history for ticket ${placed.ticket}...`);
  const history = await mt5Client.getOrderHistory(placed.ticket);
  console.log('order_history', history);
  assert(history.ticket === placed.ticket, 'history ticket mismatch');
  assert(typeof history.close_price === 'number' && history.close_price > 0, 'expected a real close_price');
  assert(typeof history.profit === 'number', 'expected a numeric profit from history');

  console.log('MT5_ORDER_46_PASS');
}

main().catch((err) => {
  console.error('FAIL', err.message);
  console.error(err.stack);
  // exitCode, not exit(1) -- forcing an immediate exit while fetch's
  // connection pool is still tearing down triggers a native libuv
  // assertion crash on this Node/Windows combo (observed independent
  // of this script's own logic, on the pre-existing abort branches
  // above too). Setting exitCode and letting the event loop drain
  // naturally avoids that without changing the actual exit status.
  process.exitCode = 1;
});
