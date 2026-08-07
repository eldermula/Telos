/**
 * Phase 7.8 smoke — closes the gap flagged during the 7.6 Admin review:
 * `PATCH /admin/risk-tiers/:tier` writes to Postgres, but until this
 * increment, APIRS's `positionSizing.js` only ever read its own
 * hardcoded `TIER_MATRIX` copy, so admin edits never reached live risk
 * sizing. Verifies, end-to-end, against a real paper BotRuntime tick:
 *
 *   1. Before any admin edit, a new position opens using the seeded
 *      (== hardcoded-matrix) tier 0 ceiling.
 *   2. While that position is still OPEN, an admin edits tier 0's
 *      max_risk_ceiling. The open position's persisted
 *      final_applied_position_risk is confirmed UNCHANGED afterward —
 *      already-open trades are frozen at entry, never retroactively
 *      resized.
 *   3. Only the *next* evaluation cycle (the next tick's new position)
 *      picks up the edited ceiling — confirming "next cycle, not
 *      retroactive" exactly as designed/approved.
 *   4. The edit is visible on that very next tick (no 20s TTL wait),
 *      confirming invalidate-on-write cache invalidation, not just the
 *      TTL safety net.
 *
 * Mutates the shared `risk_tier_config` table (tier 0) for the duration
 * of the run — original values are captured up front and restored in a
 * `finally`, regardless of pass/fail, so no other bot instance/test is
 * left with a corrupted global config.
 *
 * Requires: Postgres + Redis + MT5 connector reachable (same
 * preconditions as smoke-bot-runtime-43.js), and the API server running
 * on 127.0.0.1:3000 (for the admin PATCH — everything else talks to the
 * engine in-process).
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
  const adminEmail = `tierlive78_admin_${stamp}@telos.test`;
  const userEmail = `tierlive78_user_${stamp}@telos.test`;
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

  // Capture tier 0's original row so it can be restored no matter what
  // happens below — this table is shared/global, not test-scoped.
  const originalTier0 = (
    await client.query(
      `SELECT step_size, base_risk, max_risk_ceiling FROM risk_tier_config WHERE tier = 0`
    )
  ).rows[0];
  assert(originalTier0, 'expected a seeded tier 0 row');

  const adminLogin = await req('POST', '/auth/login', { body: { email: adminEmail, password } });
  assert(adminLogin.status === 200 && adminLogin.json.token, `admin login failed: ${JSON.stringify(adminLogin.json)}`);
  const adminToken = adminLogin.json.token;

  let openTradeRowId = null;
  let secondTradeSymbol = null;

  try {
    // --- Step 0: force this user's bot instance into the standard
    // regime at tier 0, with net_profit pinned at 0 (balance ==
    // initial_balance == peak_equity) so profit-lock/tier-advancement
    // can't fire mid-test and confound which tier's config is in play.
    const instance = await require('../src/engine/bot-instance.repository').ensureForUser(userId);
    await client.query(
      `UPDATE bot_instances
       SET active_trading_balance = 60, peak_equity = 60, initial_balance = 60, current_tier = 0
       WHERE id = $1`,
      [instance.id]
    );

    // --- Step 1: baseline — confirm the live-read service currently
    // returns the seeded (== hardcoded matrix) tier 0 ceiling.
    const baselineRows = await riskTierConfigService.getTierRows();
    const baselineTier0 = baselineRows.find((r) => r.tier === 0);
    assert(baselineTier0, 'expected tier 0 in baseline tierRows');
    console.log('baseline_tier0_ceiling', baselineTier0.maxRiskCeiling);
    assert(
      Math.abs(baselineTier0.maxRiskCeiling - Number(originalTier0.max_risk_ceiling)) < 1e-9,
      'baseline live read should match the seeded DB row'
    );

    // --- Step 2: open the first position (pre-edit) against the real
    // engine — should size using the *unedited* tier 0 ceiling.
    const session = await tradingEngine.startSession(userId, {
      autoTick: false,
      strategySelection: makeFakeStrategySelection({ strategyConfidence: 1 }),
    });
    assert(session.status === 'running', 'expected running');
    const runtime = getRuntime(session.bot_instance_id);
    assert(runtime, 'runtime not registered');

    const open1 = await runtime.tickOnce();
    assert(open1 && open1.entryResult.tradeApproved, 'first tick should approve and open');
    assert(open1.trade && open1.trade.status === 'open', 'expected an open paper position');
    openTradeRowId = open1.trade.id;
    const preEditCeiling = open1.entryResult.riskResult.sizing.tierParams.maxRiskCeiling;
    const preEditAppliedRisk = open1.entryResult.riskResult.appliedRisk;
    console.log('trade1_opened', {
      ceiling_used: preEditCeiling,
      applied_risk: preEditAppliedRisk,
    });
    assert(
      Math.abs(preEditCeiling - Number(originalTier0.max_risk_ceiling)) < 1e-9,
      `expected trade1 to size against the unedited ceiling (${originalTier0.max_risk_ceiling}), got ${preEditCeiling}`
    );

    // --- Step 3: WHILE trade1 is still open, admin edits tier 0's
    // ceiling to something drastically different.
    const editedCeiling = 0.9;
    const patchRes = await req('PATCH', '/admin/risk-tiers/0', {
      token: adminToken,
      body: { max_risk_ceiling: editedCeiling },
    });
    assert(patchRes.status === 200, `patch failed: ${JSON.stringify(patchRes.json)}`);
    assert(
      Math.abs(Number(patchRes.json.max_risk_ceiling) - editedCeiling) < 1e-9,
      'patch response should reflect the new ceiling'
    );
    console.log('admin_patched_tier0_ceiling', editedCeiling);

    // Confirm the cache key was actually invalidated (not just eventually
    // expiring on its own TTL) — a direct, unambiguous check of the
    // invalidate-on-write behavior itself.
    const cachedAfterPatch = await redis.get(riskTierConfigService.CACHE_KEY);
    assert(cachedAfterPatch === null, 'expected the tier-config cache key to be cleared by the admin patch');

    // --- Step 4: mid-trade safety — resolve trade1 (still using
    // whatever price/stop/target it was opened with) and confirm its
    // PERSISTED final_applied_position_risk is untouched by the edit
    // that happened while it was open.
    const cycle1 = await tickUntilClosed(runtime);
    const closed1 = cycle1[cycle1.length - 1];
    console.log('trade1_closed', { pnl: closed1.trace.pnlAmount, balance: closed1.state.balance });

    const persistedTrade1 = await client.query(
      `SELECT final_applied_position_risk, status FROM trades WHERE id = $1`,
      [openTradeRowId]
    );
    assert(persistedTrade1.rows[0].status === 'closed', 'trade1 should be closed in the DB');
    assert(
      Math.abs(Number(persistedTrade1.rows[0].final_applied_position_risk) - preEditAppliedRisk) < 1e-9,
      `trade1's persisted risk (${persistedTrade1.rows[0].final_applied_position_risk}) should still equal its at-entry value (${preEditAppliedRisk}), unaffected by the concurrent edit`
    );
    console.log('MID_TRADE_SAFETY_CONFIRMED — open position was not retroactively resized');

    // --- Step 5: the *next* evaluation cycle should now see the
    // edited ceiling — try up to a few ticks since strategy mode may
    // have switched (same branchy behavior as smoke-bot-runtime-43.js).
    let open2 = null;
    for (let i = 0; i < 5 && !open2; i += 1) {
      const attempt = await runtime.tickOnce();
      if (attempt && attempt.trade && attempt.trade.status === 'open') {
        open2 = attempt;
        break;
      }
      if (attempt && attempt.entryResult && !attempt.entryResult.tradeApproved) {
        console.log('open2_attempt_rejected', attempt.entryResult.reason);
        continue;
      }
    }
    assert(open2, 'expected a second position to open within a few ticks to observe the edited ceiling');
    secondTradeSymbol = open2.trade.symbol;
    const postEditCeiling = open2.entryResult.riskResult.sizing.tierParams.maxRiskCeiling;
    console.log('trade2_opened', { ceiling_used: postEditCeiling });
    assert(
      Math.abs(postEditCeiling - editedCeiling) < 1e-9,
      `expected trade2 to size against the edited ceiling (${editedCeiling}), got ${postEditCeiling}`
    );
    console.log('LIVE_READ_CONFIRMED — next evaluation cycle used the admin-edited ceiling');

    // Drain trade2 so the session ends clean.
    await tickUntilClosed(runtime);

    const stopped = await tradingEngine.stopSession(userId);
    assert(stopped.status === 'stopped', 'expected stopped');
  } finally {
    // --- Restore the shared risk_tier_config row, unconditionally.
    await client.query(
      `UPDATE risk_tier_config SET step_size = $1, base_risk = $2, max_risk_ceiling = $3 WHERE tier = 0`,
      [originalTier0.step_size, originalTier0.base_risk, originalTier0.max_risk_ceiling]
    );
    await riskTierConfigService.invalidateCache();
    console.log('tier0_restored', originalTier0);
  }

  await botStatusCache.deleteStatus((await require('../src/engine/bot-instance.repository').findByUserId(userId)).id);
  await client.query(`DELETE FROM users WHERE id IN ($1, $2)`, [adminId, userId]);
  await client.end();
  redis.disconnect();

  console.log('RISK_TIER_LIVE_78_PASS');
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
