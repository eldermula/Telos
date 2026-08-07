/**
 * Phase 4.1 smoke — Trading Engine scaffold.
 * Directly exercises ensure/load + Redis status cache (no HTTP trading
 * routes yet — those are 4.2). Inserts a synthetic broker_connection so
 * this does not depend on the MT5 connector being up.
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcrypt'));
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const { connectRedis, redis } = require('../src/db/redis');
const tradingEngine = require('../src/engine/trading-engine');
const botStatusCache = require('../src/engine/bot-status.cache');
const { INITIAL_BALANCE } = require('../src/engine/bot-instance.repository');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  await connectRedis();

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const email = `engine41_${Date.now()}@telos.test`;
  const passwordHash = await bcrypt.hash('Password123!', 12);

  const userRes = await client.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, $2, 'user')
     RETURNING id`,
    [email, passwordHash]
  );
  const userId = userRes.rows[0].id;

  await client.query(
    `INSERT INTO settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [userId]
  );

  // Synthetic connected broker row — schema requires encrypted_credentials
  // NOT NULL; content is opaque for this smoke (never decrypted here).
  const connRes = await client.query(
    `INSERT INTO broker_connections
       (user_id, broker_name, encrypted_credentials, connection_status, account_type, linked_at, last_validated_at)
     VALUES ($1, 'mt5', decode('00', 'hex'), 'connected', 'demo', now(), now())
     RETURNING id`,
    [userId]
  );
  const brokerConnectionId = connRes.rows[0].id;

  // No broker → error
  const orphanEmail = `orphan41_${Date.now()}@telos.test`;
  const orphanHash = await bcrypt.hash('Password123!', 12);
  const orphanRes = await client.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`,
    [orphanEmail, orphanHash]
  );
  let threw = false;
  try {
    await tradingEngine.ensureBotInstance(orphanRes.rows[0].id);
  } catch (err) {
    threw = true;
    assert(err.code === 'NO_BROKER_CONNECTION', `expected NO_BROKER_CONNECTION, got ${err.code}`);
  }
  assert(threw, 'expected ensure without broker to throw');

  const first = await tradingEngine.ensureBotInstance(userId);
  console.log('ensure_first', {
    id: first.id,
    status: first.status,
    balance: first.active_trading_balance,
    tier: first.current_tier,
  });
  assert(first.user_id === userId, 'user_id mismatch');
  assert(first.broker_connection_id === brokerConnectionId, 'broker_connection_id mismatch');
  assert(first.status === 'stopped', 'expected stopped');
  assert(first.active_strategy_mode === 'STRATEGY_A', 'expected STRATEGY_A');
  assert(first.active_trading_balance === INITIAL_BALANCE, 'expected INITIAL_BALANCE');
  assert(first.peak_equity === INITIAL_BALANCE, 'expected peak = initial');
  assert(first.current_tier === 0, 'expected tier 0');

  const second = await tradingEngine.ensureBotInstance(userId);
  assert(second.id === first.id, 'ensure must be idempotent (same row)');

  const count = await client.query(
    `SELECT count(*)::int AS n FROM bot_instances WHERE user_id = $1`,
    [userId]
  );
  assert(count.rows[0].n === 1, `expected 1 bot_instances row, got ${count.rows[0].n}`);

  const cached = await botStatusCache.getStatus(first.id);
  console.log('redis_status', cached);
  assert(cached, 'expected Redis status key');
  assert(cached.bot_instance_id === first.id, 'cache bot_instance_id mismatch');
  assert(cached.status === 'stopped', 'cache status mismatch');
  assert(cached.active_strategy_mode === 'STRATEGY_A', 'cache mode mismatch');
  assert(cached.current_tier === 0, 'cache tier mismatch');
  assert(Number(cached.active_trading_balance) === INITIAL_BALANCE, 'cache balance mismatch');
  assert(Number(cached.peak_equity) === INITIAL_BALANCE, 'cache peak mismatch');

  const session = await tradingEngine.getSessionForUser(userId);
  assert(session.bot_instance_id === first.id, 'session id mismatch');
  assert(session.status === 'stopped', 'session status mismatch');

  // Cleanup
  await botStatusCache.deleteStatus(first.id);
  await client.query(`DELETE FROM users WHERE id = $1 OR id = $2`, [
    userId,
    orphanRes.rows[0].id,
  ]);
  await client.end();
  redis.disconnect();

  console.log('TRADING_ENGINE_41_PASS');
}

main().catch(async (err) => {
  console.error('FAIL', err.message);
  try {
    redis.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
