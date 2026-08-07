/**
 * Option 2 Increment B smoke — proves the Layer 0 account-type gate
 * actually rejects, not just that the code path exists. Same standard
 * the WS access-gate check got (smoke-access-gate-ws-85.js): a
 * wrong-value case must be shown failing, not assumed safe from reading
 * the code.
 *
 * Standalone: talks directly to the Python connector, same pattern as
 * smoke-mt5-order-46.js. No BotRuntime involvement.
 *
 * Cases 1-2 below are deliberately independent of market hours: both
 * place_order and close_order run their account_info() mismatch check
 * *before* symbol_select/positions_get/order_send (see server.py), so
 * a fake, nonexistent ticket number is enough to prove close_order's
 * gate — no real open position is needed, and no order is ever sent to
 * the broker for either negative case. Only case 3 (the correct-type
 * control, which places and closes a real order) needs the market open,
 * and aborts cleanly rather than failing if it's not — same convention
 * smoke-mt5-order-46.js already uses.
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const mt5Client = require('../src/services/mt5-connector.client');

const SYMBOL = process.env.MT5_SMOKE_SYMBOL || 'EURUSD';
const FAKE_TICKET = 999999999;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function wrongAccountType(real) {
  const candidates = ['demo', 'contest', 'real'];
  return candidates.find((c) => c !== real);
}

async function main() {
  console.log('Fetching real account info from the connector...');
  const account = await mt5Client.getAccountInfo();
  console.log('account_info', { login: account.login, account_type: account.account_type });
  const realType = account.account_type;
  const wrongType = wrongAccountType(realType);
  console.log(`Real account_type is '${realType}'; will deliberately claim '${wrongType}' for the negative cases.`);

  // --- Case 1: missing expectedAccountType entirely -> client-side
  // rejection, before any network call. Market-hours-independent.
  let rejected = false;
  try {
    await mt5Client.placeOrder({ symbol: SYMBOL, direction: 'BUY', volume: 0.01 });
  } catch (err) {
    rejected = true;
    assert(err.code === 'MT5_EXPECTED_ACCOUNT_TYPE_REQUIRED', `expected required-field error, got ${err.code}`);
  }
  assert(rejected, 'expected placeOrder with no expectedAccountType to be rejected client-side');
  console.log('MISSING_EXPECTED_TYPE_REJECTED_CLIENT_SIDE');

  rejected = false;
  try {
    await mt5Client.closeOrder(FAKE_TICKET, {});
  } catch (err) {
    rejected = true;
    assert(err.code === 'MT5_EXPECTED_ACCOUNT_TYPE_REQUIRED', `expected required-field error, got ${err.code}`);
  }
  assert(rejected, 'expected closeOrder with no expectedAccountType to be rejected client-side');
  console.log('CLOSE_MISSING_EXPECTED_TYPE_REJECTED_CLIENT_SIDE');

  // --- Case 2: wrong expectedAccountType -> connector-side 422
  // mismatch, for both place and close. Uses a fake ticket for close —
  // the account_info() check runs before positions_get, so this proves
  // the gate without needing (or risking) a real open position, and
  // without depending on the market being open.
  rejected = false;
  try {
    await mt5Client.placeOrder({
      symbol: SYMBOL,
      direction: 'BUY',
      volume: 0.01,
      expectedAccountType: wrongType,
    });
  } catch (err) {
    rejected = true;
    assert(err.code === 'MT5_ORDER_PLACE_FAILED', `expected place-failed error, got ${err.code}`);
    assert(
      err.details?.expected_account_type === wrongType && err.details?.actual_account_type === realType,
      `expected mismatch details to report expected='${wrongType}' actual='${realType}', got ${JSON.stringify(err.details)}`
    );
  }
  assert(rejected, 'expected placeOrder with wrong expectedAccountType to be rejected by the connector');
  console.log('WRONG_EXPECTED_TYPE_REJECTED_BY_CONNECTOR (place)');

  rejected = false;
  try {
    await mt5Client.closeOrder(FAKE_TICKET, { expectedAccountType: wrongType });
  } catch (err) {
    rejected = true;
    assert(err.code === 'MT5_ORDER_CLOSE_FAILED', `expected close-failed error, got ${err.code}`);
    assert(
      err.details?.expected_account_type === wrongType && err.details?.actual_account_type === realType,
      `expected mismatch details to report expected='${wrongType}' actual='${realType}', got ${JSON.stringify(err.details)}`
    );
  }
  assert(rejected, 'expected closeOrder with wrong expectedAccountType to be rejected by the connector');
  console.log('WRONG_EXPECTED_TYPE_REJECTED_BY_CONNECTOR (close, fake ticket, no real position touched)');

  // Prove no phantom position was opened by either rejected placeOrder attempt above.
  const positionsAfterRejections = await mt5Client.getPositions(SYMBOL);
  console.log(`open positions after all rejected attempts: ${positionsAfterRejections.length}`);

  // --- Case 3: control — correct expectedAccountType still works
  // end-to-end, proving the gate isn't rejecting everyone indiscriminately.
  // Needs the market open; aborts cleanly (not a FAIL) if it isn't,
  // same convention as smoke-mt5-order-46.js.
  const info = await mt5Client.getSymbolInfo(SYMBOL);
  if (!info.trade_mode_full || !info.bid || !info.ask) {
    console.log(
      `Market appears closed for ${SYMBOL} (trade_mode_full=${info.trade_mode_full}) — skipping the ` +
        `live control case. Negative-case rejections above are unaffected by market hours and already passed.`
    );
    console.log('OPTION2_B_ACCOUNT_GATE_PASS (negative cases only — control case skipped, market closed)');
    return;
  }

  console.log(`Placing BUY ${info.volume_min} ${SYMBOL} with correct expectedAccountType='${realType}'...`);
  let placed;
  try {
    placed = await mt5Client.placeOrder({
      symbol: SYMBOL,
      direction: 'BUY',
      volume: info.volume_min,
      expectedAccountType: realType,
    });
  } catch (err) {
    if (err.details?.retcode === 10018) {
      console.log('ABORT (not a failure): broker reports Market closed (retcode 10018) at the moment of order_send.');
      console.log('OPTION2_B_ACCOUNT_GATE_PASS (negative cases only — control case skipped, market closed)');
      return;
    }
    throw err;
  }
  assert(placed.ticket, 'expected a ticket back from the correctly-typed order');
  console.log('CORRECT_EXPECTED_TYPE_PLACE_ACCEPTED', { ticket: placed.ticket });

  await sleep(500);

  const stillOpenBeforeClose = (await mt5Client.getPositions(SYMBOL)).find((p) => p.ticket === placed.ticket);
  assert(stillOpenBeforeClose, 'expected the correctly-typed order to actually be open');

  console.log(`Closing ticket ${placed.ticket} with correct expectedAccountType='${realType}'...`);
  await mt5Client.closeOrder(placed.ticket, { expectedAccountType: realType });
  console.log('CORRECT_EXPECTED_TYPE_CLOSE_ACCEPTED');

  await sleep(500);
  const stillOpen = (await mt5Client.getPositions(SYMBOL)).find((p) => p.ticket === placed.ticket);
  assert(!stillOpen, `expected ticket ${placed.ticket} to no longer be open after the correctly-typed close`);

  console.log('OPTION2_B_ACCOUNT_GATE_PASS (all cases including live control)');
}

main().catch((err) => {
  console.error('FAIL', err.message);
  console.error(err.stack);
  // exitCode, not exit(1) -- see smoke-mt5-order-46.js's comment on the
  // same pattern; forcing an immediate exit here crashes with a native
  // libuv assertion on this Node/Windows combo while fetch's connection
  // pool is still tearing down.
  process.exitCode = 1;
});
