/**
 * Increment 6.5 — verifies the `conditions`-persistence design actually
 * landed correctly against a live DB + live MT5 price feed:
 *
 *   1. A freshly opened trade's row has a real, non-null `conditions`
 *      value matching that tick's actual tradeInput/selection (not the
 *      raw `selection`/`marketIntelligence` object — no OHLC bars).
 *   2. Restart-resume (`BotRuntime.initialize()`) reads the persisted
 *      `conditions` back onto `this.openPosition`, not leaving it unset.
 *   3. `resolveExit` receives a non-null `conditions` (not the old
 *      hardcoded/defaulted `null`) once the position resolves.
 *   4. `loadTradeHistoryForLearning` returns the most recent N trades in
 *      chronological oldest-first order (DESC query + JS reverse), not
 *      the oldest N (the old `ASC LIMIT` bug) — verified here against
 *      >50 seeded closed trades so the bug would actually be visible if
 *      it regressed.
 *
 * Requires the MT5 connector + a terminal attached to the linked demo
 * account (same requirement as smoke-bot-runtime-43.js).
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcrypt'));
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const { connectRedis, redis } = require('../src/db/redis');
const tradingEngine = require('../src/engine/trading-engine');
const { getRuntime, BotRuntime } = require('../src/engine/bot-runtime');
const tradesRepository = require('../src/engine/trades.repository');
const mt5Connector = require('../src/services/mt5-connector.client');
const { makeFakeStrategySelection } = require('./test-helpers/fake-strategy-selection');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  await connectRedis();

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const email = `conditions65_${Date.now()}@telos.test`;
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

  const session = await tradingEngine.startSession(userId, {
    autoTick: false,
    strategySelection: makeFakeStrategySelection(),
  });
  const botInstanceId = session.bot_instance_id;
  const runtime = getRuntime(botInstanceId);
  assert(runtime, 'runtime not registered');

  // --- 1. Open a position, inspect the raw row's `conditions` column ---
  const openResult = await runtime.tickOnce();
  assert(openResult && openResult.trade && openResult.trade.status === 'open', 'expected an open position');
  const openedTradeId = openResult.trade.id;

  const rawRow = await client.query(`SELECT conditions FROM trades WHERE id = $1`, [openedTradeId]);
  const conditions = rawRow.rows[0].conditions;
  assert(conditions !== null, 'expected trades.conditions to be non-null at open time');
  console.log('conditions_at_open', conditions);

  assert(typeof conditions.strategyConfidence === 'number', 'expected strategyConfidence in conditions');
  assert(typeof conditions.trendQuality === 'number', 'expected trendQuality in conditions');
  assert(typeof conditions.marketQuality === 'number', 'expected marketQuality in conditions');
  assert(conditions.marketVolatility === 'NORMAL', 'expected marketVolatility from the fake selection');
  assert(conditions.strategy_id === 'fake-strategy-id', 'expected strategy_id threaded through from selection');
  assert(conditions.strategy_name === 'MA Crossover', 'expected strategy_name threaded through from selection');
  assert(!('chosen_instrument' in conditions), 'chosen_instrument must be excluded (already trades.symbol)');
  assert(!('marketIntelligence' in conditions), 'raw selection.marketIntelligence must never be serialized (OHLC bloat trap)');
  const inMemory = runtime.openPosition.conditions;
  for (const key of Object.keys(conditions)) {
    assert(inMemory[key] === conditions[key], `in-memory openPosition.conditions.${key} does not match the persisted row`);
  }
  console.log('open_time_conditions_shape_ok');

  // --- 2. Restart-resume, tested against position 1 while it's still
  //        open (avoids depending on whether a second entry ever gets
  //        approved — a loss on position 1 can legitimately escalate
  //        into STRATEGY_B, where the fake's fixed 0.85 confidence
  //        permanently sits below the 0.90 bar, same known branch
  //        smoke-bot-runtime-43.js documents). A fresh BotRuntime
  //        against the same instance should read `conditions` back off
  //        the still-open DB row, not leave it unset. ---
  const freshRuntime = new BotRuntime({ id: botInstanceId, user_id: userId }, { autoTick: false });
  await freshRuntime.initialize();
  freshRuntime.start(); // real restart-resume calls this via startRuntime() — tickOnce() no-ops while !running
  assert(freshRuntime.openPosition, 'expected initialize() to resume the open position');
  assert(freshRuntime.openPosition.tradeRowId === openedTradeId, 'resumed the wrong trade row');
  assert(freshRuntime.openPosition.conditions !== null, 'restart-resume left conditions unset (regression)');
  assert(freshRuntime.openPosition.conditions.strategy_name === 'MA Crossover', 'resumed conditions do not match what was persisted');
  for (const key of Object.keys(conditions)) {
    assert(freshRuntime.openPosition.conditions[key] === conditions[key], `resumed conditions.${key} does not match the persisted row`);
  }
  console.log('restart_resume_conditions_ok', freshRuntime.openPosition.conditions.strategy_id);

  // --- 3. Resolve the resumed position deterministically — stub the
  //        MT5 connector for exactly one tick to report a price past
  //        the resumed position's own real target, instead of waiting
  //        on live EURUSD drift to cross a tight band naturally (slow
  //        and flaky on a quiet session, as this script's own dev run
  //        confirmed: 90s+ without a live cross). This still exercises
  //        the real `_monitorOpenPositionPaper()` -> `resolveExit(..., {
  //        conditions: pos.conditions ?? null })` call site end to
  //        end — only the price input is faked, not the logic. ---
  const pos = freshRuntime.openPosition;
  const forcedPrice = pos.direction === 'BUY' ? pos.targetPrice + 0.001 : pos.targetPrice - 0.001;
  const originalGetSymbolInfo = mt5Connector.getSymbolInfo;
  mt5Connector.getSymbolInfo = async () => ({ ok: true, bid: forcedPrice, ask: forcedPrice });
  let monitorTick;
  try {
    monitorTick = await freshRuntime.tickOnce();
  } finally {
    mt5Connector.getSymbolInfo = originalGetSymbolInfo;
  }
  assert(monitorTick && monitorTick.trade && monitorTick.trade.status === 'closed',
    'expected the forced price to resolve the resumed position');
  const lastHistoryEntry = monitorTick.state.tradeHistory[monitorTick.state.tradeHistory.length - 1];
  assert(lastHistoryEntry.conditions !== null, 'resolveExit recorded null conditions (regression — the old hardcoded-null bug)');
  assert(lastHistoryEntry.conditions.strategy_name === 'MA Crossover',
    'resolveExit recorded conditions that do not match what was persisted at open time');
  console.log('resolve_exit_conditions_ok', lastHistoryEntry.conditions.strategy_id);

  await tradingEngine.stopSession(userId);

  // --- 4. Ordering fix — dedicated second user/bot_instance, exclusively
  //        seeded closed trades (no real trade mixed in, so pnl-sequence
  //        assertions below are deterministic, not timing-dependent).
  //        Seeds >50 closed trades with distinct, monotonically
  //        increasing pnl so an ASC-vs-DESC regression is trivially
  //        visible: a wrong `ASC LIMIT 50` would return pnl 0..49
  //        (oldest 50, permanently stale); the fix must return the most
  //        recent 50 (pnl 5..54), oldest-first within that window. ---
  const email2 = `conditions65b_${Date.now()}@telos.test`;
  const userRes2 = await client.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`,
    [email2, passwordHash]
  );
  const userId2 = userRes2.rows[0].id;
  await client.query(`INSERT INTO settings (user_id) VALUES ($1)`, [userId2]);
  await client.query(
    `INSERT INTO broker_connections
       (user_id, broker_name, encrypted_credentials, connection_status, account_type, linked_at, last_validated_at)
     VALUES ($1, 'mt5', decode('00', 'hex'), 'connected', 'demo', now(), now())`,
    [userId2]
  );
  const instance2 = await tradingEngine.ensureBotInstance(userId2);
  const botInstanceId2 = instance2.id;

  const seedCount = 55;
  for (let i = 0; i < seedCount; i += 1) {
    // openedAt/closedAt strictly increasing so ordering is unambiguous;
    // pnl encodes the sequence index so a wrong (oldest-first-limited)
    // read is trivially distinguishable from a correct one.
    const openedAt = new Date(Date.now() - (seedCount - i) * 1000);
    const closedAt = new Date(openedAt.getTime() + 500);
    await tradesRepository.insertClosedPaperTrade({
      botInstanceId: botInstanceId2,
      symbol: 'EURUSD',
      direction: 'BUY',
      entryPrice: 1.1,
      stopPrice: 1.09,
      targetPrice: 1.12,
      exitPrice: 1.12,
      lotSize: 0.01,
      finalAppliedPositionRisk: 0.01,
      pnl: i, // 0..54, strictly increasing with time
      openedAt,
      closedAt,
    });
  }

  const history = await tradesRepository.loadTradeHistoryForLearning(botInstanceId2, { limit: 50 });
  assert(history.length === 50, `expected 50 history entries, got ${history.length}`);
  const pnls = history.map((h) => h.pnlAmount);
  // Most recent 50 of 0..54, oldest-first within that window: [5, 6, ..., 54].
  assert(pnls[0] === 5, `expected oldest-of-window pnl=5 first, got ${pnls[0]}`);
  assert(pnls[pnls.length - 1] === 54, `expected most-recent pnl=54 last, got ${pnls[pnls.length - 1]}`);
  for (let i = 1; i < pnls.length; i += 1) {
    assert(pnls[i] === pnls[i - 1] + 1, `history not in strict chronological order at index ${i}: ${pnls.slice(0, i + 2)}`);
  }
  console.log('learning_history_order_ok', { first: pnls[0], last: pnls[pnls.length - 1], count: pnls.length });

  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId2]);
  await client.end();
  redis.disconnect();

  console.log('CONDITIONS_PERSISTENCE_65_PASS');
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
