/**
 * Phase 4.3 smoke — paper BotRuntime + APIRS + decision_log + equity.
 * Forces deterministic ticks (autoTick off) so assertions don't race a timer.
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcrypt'));
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const { connectRedis, redis } = require('../src/db/redis');
const tradingEngine = require('../src/engine/trading-engine');
const { getRuntime, buildStubTradeInput } = require('../src/engine/bot-runtime');
const botStatusCache = require('../src/engine/bot-status.cache');
const decisionLogRepository = require('../src/engine/decision-log.repository');
const { bus } = require('../src/engine/event-bus');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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
       (user_id, broker_name, encrypted_credentials, connection_status, linked_at, last_validated_at)
     VALUES ($1, 'mt5', decode('00', 'hex'), 'connected', now(), now())`,
    [userId]
  );

  const events = [];
  const onEvent = (msg) => events.push(msg);
  bus.on('bot-event', onEvent);

  const session = await tradingEngine.startSession(userId, { autoTick: false });
  console.log('start', session.status, session.bot_instance_id);
  assert(session.status === 'running', 'expected running');

  const runtime = getRuntime(session.bot_instance_id);
  assert(runtime, 'runtime not registered');

  const tick1 = await runtime.tickOnce(buildStubTradeInput(0));
  assert(tick1 && tick1.trace.tradeApproved, 'tick1 should approve');
  assert(tick1.trade && tick1.trade.status === 'closed', 'expected closed paper trade');
  console.log('tick1', {
    pnl: tick1.trace.pnlAmount,
    balance: tick1.state.balance,
    mode: tick1.state.activeStrategyMode,
  });

  const tick2 = await runtime.tickOnce(buildStubTradeInput(1));
  assert(tick2 && tick2.trace.tradeApproved, 'tick2 should approve');
  console.log('tick2', {
    pnl: tick2.trace.pnlAmount,
    balance: tick2.state.balance,
  });

  const decisions = await decisionLogRepository.listRecent(session.bot_instance_id, { limit: 20 });
  const types = decisions.map((d) => d.decision_type);
  console.log('decision_types', types);
  assert(types.includes('trade_approved'), 'expected trade_approved in decision_log');

  const tradeCount = await client.query(
    `SELECT count(*)::int AS n FROM trades WHERE bot_instance_id = $1 AND status = 'closed'`,
    [session.bot_instance_id]
  );
  assert(tradeCount.rows[0].n >= 2, `expected >=2 closed trades, got ${tradeCount.rows[0].n}`);

  const cached = await botStatusCache.getStatus(session.bot_instance_id);
  assert(cached.status === 'running', 'cache should stay running');
  assert(Number(cached.active_trading_balance) === tick2.state.balance, 'cache balance mismatch');

  const equityEvents = events.filter((e) => e.event === 'equity.updated');
  assert(equityEvents.length >= 2, 'expected equity.updated events');
  const tradeEvents = events.filter((e) => e.event === 'trade.closed');
  assert(tradeEvents.length >= 2, 'expected trade.closed events');

  const stopped = await tradingEngine.stopSession(userId);
  assert(stopped.status === 'stopped', 'expected stopped');
  assert(!getRuntime(session.bot_instance_id), 'runtime should be removed');

  const afterStop = await runtime.tickOnce(buildStubTradeInput(2));
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
