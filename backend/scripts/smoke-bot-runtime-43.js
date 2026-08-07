/**
 * Phase 4.3 / 6.1 / 6.4 smoke — paper BotRuntime + APIRS + decision_log
 * + equity. Forces deterministic ticks (autoTick off) so assertions
 * don't race a timer. Updated for 6.1: a tick now either opens a
 * position (status 'open', outcome unresolved) or monitors an
 * already-open one against real MT5 price until stop/target is
 * crossed — no longer a single-call instant open+close. Updated for
 * 6.4: Module 4 Selection replaces buildStubTradeInput — this test
 * injects a deterministic fake Selection (see test-helpers/fake-
 * strategy-selection.js) so it isn't at the mercy of a real,
 * edge-triggered EMA-cross/breakout/RSI-extreme happening to fire on
 * live data within the test window; Module 4's real live wiring is
 * independently verified by smoke-strategy-selection-64.js. Requires
 * the MT5 connector + a terminal attached to the linked demo account.
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcrypt'));
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const { connectRedis, redis } = require('../src/db/redis');
const tradingEngine = require('../src/engine/trading-engine');
const { getRuntime } = require('../src/engine/bot-runtime');
const botStatusCache = require('../src/engine/bot-status.cache');
const decisionLogRepository = require('../src/engine/decision-log.repository');
const { bus } = require('../src/engine/event-bus');
const { makeFakeStrategySelection } = require('./test-helpers/fake-strategy-selection');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls tickOnce() until a position closes (or resolveWithin ticks elapse). */
async function tickUntilClosed(runtime, { maxTicks = 100, intervalMs = 300 } = {}) {
  const seen = [];
  for (let i = 0; i < maxTicks; i += 1) {
    const result = await runtime.tickOnce();
    if (result) seen.push(result);
    if (result && result.trade && result.trade.status === 'closed') {
      return seen;
    }
    await sleep(intervalMs);
  }
  throw new Error(`position did not resolve within ${maxTicks} ticks`);
}

async function main() {
  await connectRedis();

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const email = `runtime43_${Date.now()}@telos.test`;
  const passwordHash = await bcrypt.hash('Password123!', 12);
  const userRes = await client.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`,
    [email, passwordHash]
  );
  const userId = userRes.rows[0].id;
  await client.query(`INSERT INTO settings (user_id) VALUES ($1)`, [userId]);
  await client.query(
    `INSERT INTO broker_connections
       (user_id, broker_name, encrypted_credentials, connection_status, account_type, linked_at, last_validated_at)
     VALUES ($1, 'mt5', decode('00', 'hex'), 'connected', 'demo', now(), now())`,
    [userId]
  );

  const events = [];
  const onEvent = (msg) => events.push(msg);
  bus.on('bot-event', onEvent);

  const session = await tradingEngine.startSession(userId, {
    autoTick: false,
    strategySelection: makeFakeStrategySelection(),
  });
  console.log('start', session.status, session.bot_instance_id);
  assert(session.status === 'running', 'expected running');

  const runtime = getRuntime(session.bot_instance_id);
  assert(runtime, 'runtime not registered');

  const openResult = await runtime.tickOnce();
  assert(openResult && openResult.entryResult.tradeApproved, 'first tick should approve and open');
  assert(openResult.trade && openResult.trade.status === 'open', 'expected an open paper position');
  // 6.4 — trades.symbol should record the instrument Module 4
  // Selection actually chose (from the injected fake, 'EURUSD' here),
  // not a hardcoded default.
  assert(openResult.trade.symbol === 'EURUSD', `expected trade.symbol='EURUSD', got ${openResult.trade.symbol}`);
  console.log('opened', {
    symbol: openResult.trade.symbol,
    direction: openResult.trade.direction,
    entry: openResult.trade.entry_price,
    stop: openResult.trade.stop_price,
    target: openResult.trade.target_price,
  });

  const cycle1 = await tickUntilClosed(runtime);
  const closed1 = cycle1[cycle1.length - 1];
  assert(closed1.trace.tradeApproved, 'resolved trade should be marked approved in trace');
  console.log('closed1', {
    pnl: closed1.trace.pnlAmount,
    balance: closed1.state.balance,
    mode: closed1.state.activeStrategyMode,
  });

  // Second tick's outcome is legitimately branchy, not a bug: a loss on
  // cycle1 at the bootstrap 70%-ceiling correctly fires the Section
  // 3a/7 single-loss override into STRATEGY_B (see closed1.state.mode
  // above), and STRATEGY_B's 0.90 confidence bar (Section 6.1) then
  // correctly rejects the fake Selection's fixed 0.85 confidence — 0.85
  // was deliberately kept below that bar (see fake-strategy-selection.js)
  // so this real APIRS branch stays exercised. A win on cycle1 stays in
  // STRATEGY_A instead, where no confidence bar applies, so the second
  // position opens normally. Both are real, valid engine behavior;
  // assert on whichever one actually happened rather than assuming
  // only the win path.
  const open2 = await runtime.tickOnce();
  let expectedClosedCount = 1;
  let lastClosed = closed1;
  if (open2 && open2.trade && open2.trade.status === 'open') {
    const cycle2 = await tickUntilClosed(runtime);
    const closed2 = cycle2[cycle2.length - 1];
    console.log('closed2', {
      pnl: closed2.trace.pnlAmount,
      balance: closed2.state.balance,
    });
    expectedClosedCount = 2;
    lastClosed = closed2;
  } else {
    assert(open2 && open2.entryResult && open2.entryResult.reason === 'BELOW_STRATEGY_B_CONFIDENCE_BAR',
      `expected second tick to either open or be rejected on the Strategy B confidence bar, got: ${JSON.stringify(open2 && open2.entryResult)}`);
    console.log('second_tick_rejected_strategy_b_confidence_bar', open2.entryResult.reason);
  }

  const decisions = await decisionLogRepository.listRecent(session.bot_instance_id, { limit: 20 });
  const types = decisions.map((d) => d.decision_type);
  console.log('decision_types', types);
  assert(types.includes('trade_approved'), 'expected trade_approved (position opened) in decision_log');
  assert(types.includes('trade_closed'), 'expected trade_closed (position resolved) in decision_log');

  const tradeCount = await client.query(
    `SELECT count(*)::int AS n FROM trades WHERE bot_instance_id = $1 AND status = 'closed'`,
    [session.bot_instance_id]
  );
  assert(
    tradeCount.rows[0].n >= expectedClosedCount,
    `expected >=${expectedClosedCount} closed trades, got ${tradeCount.rows[0].n}`
  );

  const cached = await botStatusCache.getStatus(session.bot_instance_id);
  assert(cached.status === 'running', 'cache should stay running');
  assert(Number(cached.active_trading_balance) === lastClosed.state.balance, 'cache balance mismatch');

  const equityEvents = events.filter((e) => e.event === 'equity.updated');
  assert(equityEvents.length >= expectedClosedCount, 'expected equity.updated events');
  const tradeEvents = events.filter((e) => e.event === 'trade.closed');
  assert(tradeEvents.length >= expectedClosedCount, 'expected trade.closed events');

  const stopped = await tradingEngine.stopSession(userId);
  assert(stopped.status === 'stopped', 'expected stopped');
  assert(!getRuntime(session.bot_instance_id), 'runtime should be removed');

  const afterStop = await runtime.tickOnce();
  assert(afterStop === null, 'tick after stop must no-op');

  bus.off('bot-event', onEvent);
  await botStatusCache.deleteStatus(session.bot_instance_id);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.end();
  redis.disconnect();

  console.log('BOT_RUNTIME_43_PASS');
}

main().catch(async (err) => {
  console.error('FAIL', err.message);
  console.error(err.stack);
  try {
    redis.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
