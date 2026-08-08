/**
 * Option 2 E.8 — live demo end-to-end round-trip through BotRuntime.
 *
 * Requires (non-production):
 *   REAL_TRADING_ENABLED=true
 *   REAL_TRADING_ALLOW_DEMO=true
 *   local MT5 connector + MetaQuotes-Demo terminal attached
 *   forex market open (trade_mode_full)
 *
 * Flow:
 *   confirm-live (demo allowed under E1) → Start → tick open real
 *   demo order → connector close → tick monitor reconcile → assert
 *   trade row / decision log / Layer 0 expected_account_type=demo.
 *
 * Aborts cleanly (exit 0, not FAIL) when the connector is down or the
 * market is closed — same discipline as smoke-mt5-order-46.js.
 *
 * Negative kill-switch / bypass / production-boot cases remain covered
 * by E.0/E.1 unit tests; this smoke proves the success path live.
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

// Force E1 flags for this process after dotenv (do not rely on .env).
process.env.REAL_TRADING_ENABLED = 'true';
process.env.REAL_TRADING_ALLOW_DEMO = 'true';
delete require.cache[require.resolve('../src/config/env')];

const net = require('net');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcrypt'));
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const { encryptCredentials } = require('../src/services/credential-crypto.service');
const mt5Connector = require('../src/services/mt5-connector.client');
const { LIVE_TRADING_CONFIRMATION_PHRASE } = require('../src/engine/live-trading-confirmation');
const { makeFakeStrategySelection } = require('./test-helpers/fake-strategy-selection');
const {
  REAL_TRADING_ENABLED,
  REAL_TRADING_ALLOW_DEMO,
  DATABASE_URL,
  REDIS_URL,
} = require('../src/config/env');

const SYMBOL = process.env.MT5_SMOKE_SYMBOL || 'EURUSD';

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tcpOpen(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function parseHostPort(url, fallbackPort) {
  try {
    const u = new URL(url);
    return { host: u.hostname || '127.0.0.1', port: Number(u.port) || fallbackPort };
  } catch {
    return { host: '127.0.0.1', port: fallbackPort };
  }
}

async function main() {
  assert(REAL_TRADING_ENABLED === true, 'REAL_TRADING_ENABLED must parse true in this process');
  assert(REAL_TRADING_ALLOW_DEMO === true, 'REAL_TRADING_ALLOW_DEMO must parse true in this process');

  const pg = parseHostPort(DATABASE_URL.replace(/^postgresql:/, 'http:'), 5432);
  const rd = parseHostPort(REDIS_URL.replace(/^redis:/, 'http:'), 6379);
  if (!(await tcpOpen(pg.host, pg.port)) || !(await tcpOpen(rd.host, rd.port))) {
    console.log(
      'OPTION2_E8_SKIP_DB_UNAVAILABLE',
      `postgres ${pg.host}:${pg.port} / redis ${rd.host}:${rd.port} not reachable — start Docker and re-run`
    );
    process.exitCode = 0;
    return;
  }

  // Load Redis/engine only after DB ports are up (avoids hung reconnect loops).
  const { connectRedis, redis } = require('../src/db/redis');
  const tradingEngine = require('../src/engine/trading-engine');
  const { getRuntime, stopRuntime } = require('../src/engine/bot-runtime');
  const decisionLogRepository = require('../src/engine/decision-log.repository');
  const tradesRepository = require('../src/engine/trades.repository');

  let liveInfo;
  try {
    liveInfo = await mt5Connector.getAccountInfo();
  } catch (err) {
    console.log('OPTION2_E8_SKIP_CONNECTOR_UNAVAILABLE', err.message);
    process.exitCode = 0;
    return;
  }
  console.log('live_account', {
    login: liveInfo.login,
    account_type: liveInfo.account_type,
    equity: liveInfo.equity,
  });
  assert(liveInfo.account_type === 'demo', `E.8 expects a demo terminal, got ${liveInfo.account_type}`);

  const symbolInfo = await mt5Connector.getSymbolInfo(SYMBOL);
  console.log('symbol_info', {
    trade_mode: symbolInfo.trade_mode,
    trade_mode_full: symbolInfo.trade_mode_full,
    bid: symbolInfo.bid,
    ask: symbolInfo.ask,
    volume_min: symbolInfo.volume_min,
  });
  if (!symbolInfo.trade_mode_full || symbolInfo.bid == null || symbolInfo.ask == null) {
    console.log(
      `OPTION2_E8_ABORT_MARKET_CLOSED: ${SYMBOL} trade_mode_full=${symbolInfo.trade_mode_full} — ` +
        `re-run during forex market hours. Not a code failure.`
    );
    process.exitCode = 0;
    return;
  }

  await connectRedis();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const email = `option2e8_${Date.now()}@telos.test`;
  const passwordHash = await bcrypt.hash('Password123!', 12);
  const userRes = await client.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`,
    [email, passwordHash]
  );
  const userId = userRes.rows[0].id;
  await client.query(`INSERT INTO settings (user_id) VALUES ($1)`, [userId]);

  const matchingCreds = encryptCredentials({
    login: String(liveInfo.login),
    password: 'unused-terminal-already-attached',
    server: 'MetaQuotes-Demo',
  });
  await client.query(
    `INSERT INTO broker_connections
       (user_id, broker_name, encrypted_credentials, connection_status, account_type, linked_at, last_validated_at)
     VALUES ($1, 'mt5', $2, 'connected', 'demo', now(), now())`,
    [userId, matchingCreds]
  );

  // Layer 2 — confirm-live must accept demo under E1 bypass.
  const confirmed = await tradingEngine.confirmLiveTrading(
    userId,
    LIVE_TRADING_CONFIRMATION_PHRASE
  );
  assert(confirmed.live_trading_confirmed_at, 'confirm-live should arm demo under ALLOW_DEMO');
  console.log('CONFIRM_LIVE_DEMO_ARMED');

  const session = await tradingEngine.startSession(userId, {
    autoTick: false,
    strategySelection: makeFakeStrategySelection({
      symbol: SYMBOL,
      // Wide enough stop that placeOrder accepts; we close via connector.
      currentATR: 0.0003,
      stopMultiple: 1.5,
      targetRatio: 2,
    }),
  });
  assert(session.status === 'running', `expected running, got ${session.status}`);
  const runtime = getRuntime(session.bot_instance_id);
  assert(runtime, 'runtime registered');

  const openResult = await runtime.tickOnce();
  if (!openResult || !openResult.trade) {
    const recent = await decisionLogRepository.listRecent(session.bot_instance_id, { limit: 10 });
    const failed = recent.find((d) => d.decision_type === 'real_order_failed');
    console.error('OPEN_FAILED_DECISIONS', JSON.stringify(recent.slice(0, 5), null, 2));
    // MT5 retcode 10027 — AutoTrading disabled on the terminal (Algo Trading
    // button). Environmental, not an Option 2 logic defect.
    const msg = String((failed && failed.details && failed.details.message) || '');
    const retcode = failed && failed.details && failed.details.details && failed.details.details.retcode;
    if (retcode === 10027 || /AutoTrading disabled/i.test(msg)) {
      console.log(
        'OPTION2_E8_ABORT_AUTOTRADING_DISABLED: enable Algo Trading / AutoTrading ' +
          'on the attached MT5 terminal, then re-run. Not a code failure.'
      );
      await tradingEngine.stopSession(userId).catch(() => {});
      await stopRuntime(session.bot_instance_id).catch(() => {});
      await client.end();
      await redis.quit().catch(() => {});
      process.exitCode = 0;
      return;
    }
  }
  assert(openResult && openResult.trade, `expected a real open trade, got ${JSON.stringify(openResult)}`);
  assert(openResult.trade.execution_mode === 'real', 'trade.execution_mode must be real');
  assert(openResult.trade.broker_ticket != null, 'broker_ticket required');
  const ticket = Number(openResult.trade.broker_ticket);
  console.log('REAL_OPEN', {
    trade_id: openResult.trade.id,
    ticket,
    symbol: openResult.trade.symbol,
    lot_size: openResult.trade.lot_size,
  });

  const decisionsAfterOpen = await decisionLogRepository.listRecent(session.bot_instance_id, {
    limit: 20,
  });
  const placed = decisionsAfterOpen.find((d) => d.decision_type === 'real_order_placed');
  assert(placed, 'expected real_order_placed decision');
  assert(
    placed.details.expected_account_type === 'demo',
    `Layer 0 expected_account_type must be demo, got ${placed.details.expected_account_type}`
  );
  assert(
    placed.details.detected_account_type === 'demo',
    'detected_account_type must stay demo'
  );
  console.log('LAYER0_EXPECTED_ACCOUNT_TYPE_DEMO');

  // Close on the broker, then let the monitor reconcile (E.6 path).
  await mt5Connector.closeOrder(ticket, { expectedAccountType: 'demo' });
  console.log('CONNECTOR_CLOSE_SENT', ticket);

  let closed = null;
  for (let i = 0; i < 30; i += 1) {
    const result = await runtime.tickOnce();
    if (result && result.trade && result.trade.status === 'closed') {
      closed = result.trade;
      break;
    }
    await sleep(500);
  }
  assert(closed, 'monitor did not reconcile closed position within timeout');
  assert(closed.execution_mode === 'real', 'closed trade must remain execution_mode=real');
  assert(Number(closed.broker_ticket) === ticket, 'broker_ticket preserved on close');
  console.log('REAL_CLOSED', { pnl: closed.pnl, exit: closed.exit_price });

  const decisionsAfterClose = await decisionLogRepository.listRecent(session.bot_instance_id, {
    limit: 30,
  });
  assert(
    decisionsAfterClose.some((d) => d.decision_type === 'real_order_closed'),
    'expected real_order_closed decision'
  );

  const notif = await client.query(
    `SELECT type, message FROM notifications WHERE user_id = $1 AND type = 'real_order' ORDER BY created_at`,
    [userId]
  );
  assert(notif.rows.length >= 2, 'expected forceNotify on place and close');
  console.log('REAL_ORDER_NOTIFICATIONS', notif.rows.length);

  const openLeft = await tradesRepository.listOpenTradesForResume(session.bot_instance_id);
  assert(openLeft.length === 0, 'no open trades should remain');

  await tradingEngine.stopSession(userId);
  await stopRuntime(session.bot_instance_id);
  await client.end();
  await redis.quit().catch(() => {});

  console.log('OPTION2_E8_LIVE_DEMO_ROUNDTRIP_PASS');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
