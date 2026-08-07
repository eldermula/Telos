/**
 * Phase 7.9 smoke — closes the follow-up gap flagged during 7.8:
 * profitLock.js independently read the hardcoded TIER_MATRIX for
 * step_size/tier-advancement, uncovered by 7.8's positionSizing.js fix.
 *
 * Unlike 7.8's mid-trade *freeze* proof (an open position's sizing must
 * NOT change), profit-lock is evaluated fresh at each trade *close* —
 * there is no equivalent freeze concept here. So this smoke instead
 * proves the opposite, equally necessary property: an admin edit to
 * tier 0's step_size made *while a position is open* IS picked up by
 * that same position's close-time profit-lock evaluation, because
 * bot-runtime.js resolves its own live tierRows snapshot at the
 * exit/monitor path independently of whatever the entry path saw.
 *
 * step_size is patched to an absurdly small value (0.01) so that ANY
 * winning trade — regardless of its exact P&L magnitude, which isn't
 * fully controllable against real MT5 price movement — completes at
 * least one profit-lock block. A losing trade proves nothing about
 * step_size (profit-lock never fires on a loss, tiny step or not), so
 * this retries across a few open/close cycles until a win is observed,
 * same branchy-but-bounded approach smoke-bot-runtime-43.js already
 * uses for win/loss uncertainty.
 *
 * Mutates the shared risk_tier_config table (tier 0) for the run's
 * duration — restored in a `finally`, regardless of outcome.
 *
 * Requires: Postgres + Redis + MT5 connector reachable, API server on
 * 127.0.0.1:3000 (same preconditions as smoke-risk-tier-live-78.js).
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
const botInstanceRepository = require('../src/engine/bot-instance.repository');
const riskTierConfigService = require('../src/engine/risk-tier-config.service');
const { makeFakeStrategySelection } = require('./test-helpers/fake-strategy-selection');

const BASE = 'http://127.0.0.1:3000/api/v1';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function req(method, urlPath, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

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

  const stamp = Date.now();
  const adminEmail = `plocklive79_admin_${stamp}@telos.test`;
  const userEmail = `plocklive79_user_${stamp}@telos.test`;
  const password = 'Password123!';
  const passwordHash = await bcrypt.hash(password, 12);

  const adminId = (
    await client.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id`,
      [adminEmail, passwordHash]
    )
  ).rows[0].id;
  await client.query(`INSERT INTO settings (user_id) VALUES ($1)`, [adminId]);

  const userId = (
    await client.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`,
      [userEmail, passwordHash]
    )
  ).rows[0].id;
  await client.query(`INSERT INTO settings (user_id) VALUES ($1)`, [userId]);
  await client.query(
    `INSERT INTO broker_connections
       (user_id, broker_name, encrypted_credentials, connection_status, account_type, linked_at, last_validated_at)
     VALUES ($1, 'mt5', decode('00', 'hex'), 'connected', 'demo', now(), now())`,
    [userId]
  );

  const originalTier0 = (
    await client.query(`SELECT step_size, base_risk, max_risk_ceiling FROM risk_tier_config WHERE tier = 0`)
  ).rows[0];
  assert(originalTier0, 'expected a seeded tier 0 row');

  const adminLogin = await req('POST', '/auth/login', { body: { email: adminEmail, password } });
  assert(adminLogin.status === 200 && adminLogin.json.token, `admin login failed: ${JSON.stringify(adminLogin.json)}`);
  const adminToken = adminLogin.json.token;

  try {
    const instance = await botInstanceRepository.ensureForUser(userId);
    // net_profit = balanceAfterTrade - 60 — any winning close produces a
    // small positive net_profit; the edited step_size (0.01) is small
    // enough that even that guarantees at least one completed block.
    await client.query(
      `UPDATE bot_instances
       SET active_trading_balance = 60, peak_equity = 60, initial_balance = 60, current_tier = 0
       WHERE id = $1`,
      [instance.id]
    );

    const session = await tradingEngine.startSession(userId, {
      autoTick: false,
      strategySelection: makeFakeStrategySelection({ strategyConfidence: 1 }),
    });
    assert(session.status === 'running', 'expected running');
    const runtime = getRuntime(session.bot_instance_id);
    assert(runtime, 'runtime not registered');

    // --- Open the first position BEFORE the edit, to also exercise
    // (lightly) that an edit landing after open, before close, is what
    // gets picked up — same "edit while open" shape as 7.8's proof,
    // just for the close-time consumer instead of the entry-time one.
    const open1 = await runtime.tickOnce();
    assert(open1 && open1.entryResult.tradeApproved, 'first tick should approve and open');
    assert(open1.trade && open1.trade.status === 'open', 'expected an open paper position');

    const editedStepSize = 0.01;
    const patchRes = await req('PATCH', '/admin/risk-tiers/0', {
      token: adminToken,
      body: { step_size: editedStepSize },
    });
    assert(patchRes.status === 200, `patch failed: ${JSON.stringify(patchRes.json)}`);
    console.log('admin_patched_tier0_step_size', editedStepSize, '(while trade1 is open)');

    let win = null;
    let cycle = await tickUntilClosed(runtime);
    let closed = cycle[cycle.length - 1];

    // Retry across a few open/close cycles until a win is observed —
    // profit-lock never fires on a loss regardless of step_size, so a
    // loss doesn't exercise what this smoke is checking.
    for (let attempt = 0; attempt < 8 && !win; attempt += 1) {
      if (closed.trace.pnlAmount > 0) {
        win = closed;
        break;
      }
      console.log(`attempt_${attempt}_was_a_loss`, { pnl: closed.trace.pnlAmount });
      const openNext = await runtime.tickOnce();
      if (!openNext || !openNext.trade || openNext.trade.status !== 'open') {
        // Rejected (e.g. Strategy B confidence bar after a loss-triggered
        // switch) — nothing to close, try again next loop iteration.
        continue;
      }
      cycle = await tickUntilClosed(runtime);
      closed = cycle[cycle.length - 1];
    }

    assert(win, 'expected at least one winning close within 8 attempts to observe profit-lock firing');
    console.log('winning_close_observed', {
      pnl: win.trace.pnlAmount,
      net_profit_expected_positive: win.trace.balanceAfterTrade - 60,
    });

    assert(win.trace.profitLockResult, 'expected a profitLockResult trace on this close');
    assert(
      win.trace.profitLockResult.profitLockTriggered === true,
      `expected profit-lock to trigger given the tiny edited step_size (${editedStepSize}) — got: ${JSON.stringify(win.trace.profitLockResult)}`
    );
    assert(
      win.trace.profitLockResult.completedBlocksThisEvaluation >= 1,
      'expected at least one completed block against the edited step_size'
    );
    console.log('LIVE_READ_CONFIRMED — close-time profit-lock used the admin-edited step_size', {
      completed_blocks: win.trace.profitLockResult.completedBlocksThisEvaluation,
      new_tier: win.trace.profitLockResult.currentTier,
    });

    // Cross-check against the persisted bot_instances row too, not just
    // the in-memory trace — confirms the wiring reaches all the way
    // through to what's actually stored.
    const persisted = await client.query(`SELECT current_tier FROM bot_instances WHERE id = $1`, [instance.id]);
    assert(
      persisted.rows[0].current_tier === win.trace.profitLockResult.currentTier,
      `persisted current_tier (${persisted.rows[0].current_tier}) should match the trace (${win.trace.profitLockResult.currentTier})`
    );

    const stopped = await tradingEngine.stopSession(userId);
    assert(stopped.status === 'stopped', 'expected stopped');
  } finally {
    await client.query(
      `UPDATE risk_tier_config SET step_size = $1, base_risk = $2, max_risk_ceiling = $3 WHERE tier = 0`,
      [originalTier0.step_size, originalTier0.base_risk, originalTier0.max_risk_ceiling]
    );
    await riskTierConfigService.invalidateCache();
    console.log('tier0_restored', originalTier0);
  }

  const finalInstance = await botInstanceRepository.findByUserId(userId);
  if (finalInstance) {
    await botStatusCache.deleteStatus(finalInstance.id);
  }
  await client.query(`DELETE FROM users WHERE id IN ($1, $2)`, [adminId, userId]);
  await client.end();
  redis.disconnect();

  console.log('PROFIT_LOCK_LIVE_79_PASS');
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
