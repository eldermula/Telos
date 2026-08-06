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
    process.exit(0);
  }

  if (!info.bid || !info.ask) {
    console.log(`ABORT (not a failure): no live tick for ${SYMBOL} — market appears closed.`);
    process.exit(0);
  }

  const lotSize = info.volume_min;
  assert(lotSize > 0, 'expected a positive volume_min from connector');
  console.log(`Using confirmed minimum lot size: ${lotSize} ${SYMBOL}`);

  console.log(`Placing BUY ${lotSize} ${SYMBOL}...`);
  const placed = await mt5Client.placeOrder({ symbol: SYMBOL, direction: 'BUY', volume: lotSize });
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
  const closed = await mt5Client.closeOrder(placed.ticket);
  console.log('closed', closed);

  await sleep(500);

  positions = await mt5Client.getPositions(SYMBOL);
  const stillOpen = positions.find((p) => p.ticket === placed.ticket);
  assert(!stillOpen, `expected ticket ${placed.ticket} to no longer be open after close`);

  console.log('MT5_ORDER_46_PASS');
}

main().catch((err) => {
  console.error('FAIL', err.message);
  console.error(err.stack);
  process.exit(1);
});
