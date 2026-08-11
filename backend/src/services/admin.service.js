'use strict';

const { pool } = require('../db/pool');
const { redis } = require('../db/redis');
const { AppError } = require('../utils/app-error');
const { toMeta } = require('../utils/pagination');
const riskTierConfigService = require('../engine/risk-tier-config.service');
const syntheticDemoDispatchService = require('../engine/synthetic-demo-dispatch.service');
const forexDemoDispatchService = require('../engine/forex-demo-dispatch.service');
const { getNewsLlmUsage } = require('./news-llm-usage');
const { NEWS_LLM_ENABLED } = require('../config/env');
// M5 PAPER-ONLY EXPERIMENT (docs/14_M5_Forex_Paper_Experiment.md) — this
// harness has no real-dispatch capability at all (see its file header);
// admin start/stop here only toggles an in-memory paper simulation.
const m5PaperHarness = require('../engine/m5-paper-harness');
// M5 real-dispatch (UNPROVEN LIVE) — separate module/singleton from
// m5PaperHarness above; can place real orders once Layer 0-3 are armed.
// See backend/src/engine/m5-real-harness.js and m5-real-dispatch.js headers.
const m5RealHarness = require('../engine/m5-real-harness');
const m5DemoDispatchService = require('../engine/m5-demo-dispatch.service');
const botInstanceRepository = require('../engine/bot-instance.repository');
const { LIVE_TRADING_CONFIRMATION_PHRASE } = require('../engine/live-trading-confirmation');

const STRATEGY_STATUSES = new Set(['proposed', 'paper_testing', 'active', 'rejected']);

async function writeAudit({ adminUserId, action, targetUserId = null, details = null }) {
  const actionText =
    details == null ? action : `${action} ${JSON.stringify(details)}`;
  await pool.query(
    `INSERT INTO admin_audit_log (admin_user_id, action, target_user_id)
     VALUES ($1, $2, $3)`,
    [adminUserId, actionText, targetUserId]
  );
}

function toPublicUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listUsers({ limit = 25, offset = 0, page = 1 } = {}) {
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT id, email, role, created_at, updated_at
       FROM users
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    ),
    pool.query(`SELECT count(*)::int AS n FROM users`),
  ]);
  return {
    data: rows.rows.map(toPublicUser),
    meta: toMeta({ page, limit }, count.rows[0].n),
  };
}

async function getUser(userId) {
  const result = await pool.query(
    `SELECT id, email, role, created_at, updated_at
     FROM users
     WHERE id = $1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'User not found');
  }

  const [broker, bots, tradeAgg] = await Promise.all([
    pool.query(
      `SELECT id, broker_name, connection_status, account_type, linked_at, last_validated_at
       FROM broker_connections
       WHERE user_id = $1
       ORDER BY linked_at DESC`,
      [userId]
    ),
    pool.query(
      `SELECT id, status, active_strategy_mode, active_trading_balance, peak_equity, current_tier, updated_at
       FROM bot_instances
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    ),
    pool.query(
      `SELECT count(*)::int AS trade_count
       FROM trades t
       JOIN bot_instances b ON b.id = t.bot_instance_id
       WHERE b.user_id = $1`,
      [userId]
    ),
  ]);

  return {
    ...toPublicUser(row),
    broker_connections: broker.rows.map((b) => ({
      id: b.id,
      broker_name: b.broker_name,
      connection_status: b.connection_status,
      account_type: b.account_type,
      linked_at: b.linked_at,
      last_validated_at: b.last_validated_at,
    })),
    bot_instances: bots.rows.map((b) => ({
      id: b.id,
      status: b.status,
      active_strategy_mode: b.active_strategy_mode,
      active_trading_balance: Number(b.active_trading_balance),
      peak_equity: Number(b.peak_equity),
      current_tier: b.current_tier,
      updated_at: b.updated_at,
    })),
    trade_count: tradeAgg.rows[0].trade_count,
  };
}

async function getSystemHealth() {
  const started = Date.now();
  let postgres = { ok: false, latency_ms: null, error: null };
  let redisHealth = { ok: false, latency_ms: null, error: null };

  try {
    const t0 = Date.now();
    await pool.query('SELECT 1');
    postgres = { ok: true, latency_ms: Date.now() - t0, error: null };
  } catch (err) {
    postgres = { ok: false, latency_ms: null, error: err.message };
  }

  try {
    const t0 = Date.now();
    const pong = await redis.ping();
    redisHealth = {
      ok: pong === 'PONG',
      latency_ms: Date.now() - t0,
      error: pong === 'PONG' ? null : `unexpected ping reply: ${pong}`,
    };
  } catch (err) {
    redisHealth = { ok: false, latency_ms: null, error: err.message };
  }

  const [users, botsRunning, reports] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM users`).then((r) => r.rows[0].n).catch(() => null),
    pool
      .query(`SELECT count(*)::int AS n FROM bot_instances WHERE status = 'running'`)
      .then((r) => r.rows[0].n)
      .catch(() => null),
    pool.query(`SELECT count(*)::int AS n FROM reports`).then((r) => r.rows[0].n).catch(() => null),
  ]);

  let newsLlm = {
    enabled: NEWS_LLM_ENABLED,
    usage: null,
    usage_error: null,
  };
  try {
    newsLlm.usage = await getNewsLlmUsage(redis);
  } catch (err) {
    newsLlm.usage_error = err && err.message ? err.message : String(err);
  }

  return {
    status: postgres.ok && redisHealth.ok ? 'ok' : 'degraded',
    checked_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    postgres,
    redis: redisHealth,
    counts: {
      users,
      bots_running: botsRunning,
      reports,
    },
    news_llm: newsLlm,
  };
}

async function listRiskTiers() {
  const result = await pool.query(
    `SELECT tier, completed_blocks_min, step_size, base_risk, max_risk_ceiling
     FROM risk_tier_config
     ORDER BY tier ASC`
  );
  return {
    data: result.rows.map((row) => ({
      tier: row.tier,
      completed_blocks_min: row.completed_blocks_min,
      step_size: Number(row.step_size),
      base_risk: Number(row.base_risk),
      max_risk_ceiling: Number(row.max_risk_ceiling),
    })),
  };
}

async function patchRiskTier(adminUserId, tierParam, patch) {
  const tier = Number.parseInt(tierParam, 10);
  if (!Number.isInteger(tier) || tier < 0 || tier > 7) {
    throw new AppError(422, 'VALIDATION_ERROR', 'tier must be an integer 0–7');
  }

  const allowed = ['step_size', 'base_risk', 'max_risk_ceiling'];
  const entries = Object.entries(patch).filter(([k, v]) => allowed.includes(k) && v !== undefined);
  if (entries.length === 0) {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      'Provide at least one of step_size, base_risk, max_risk_ceiling'
    );
  }

  const sets = [];
  const params = [tier];
  for (const [key, value] of entries) {
    params.push(value);
    sets.push(`${key} = $${params.length}`);
  }

  const result = await pool.query(
    `UPDATE risk_tier_config
     SET ${sets.join(', ')}
     WHERE tier = $1
     RETURNING tier, completed_blocks_min, step_size, base_risk, max_risk_ceiling`,
    params
  );
  if (!result.rows[0]) {
    throw new AppError(404, 'NOT_FOUND', `Risk tier ${tier} not found`);
  }

  await writeAudit({
    adminUserId,
    action: 'risk_tier.update',
    details: { tier, patch: Object.fromEntries(entries) },
  });

  // Phase 7.8 — invalidate-on-write: don't make every running bot
  // instance wait out the cache TTL to see this change on its next tick.
  await riskTierConfigService.invalidateCache();

  const row = result.rows[0];
  return {
    tier: row.tier,
    completed_blocks_min: row.completed_blocks_min,
    step_size: Number(row.step_size),
    base_risk: Number(row.base_risk),
    max_risk_ceiling: Number(row.max_risk_ceiling),
  };
}

async function listCandidateStrategies({ status } = {}) {
  const params = [];
  let where = '';
  if (status) {
    if (!STRATEGY_STATUSES.has(status)) {
      throw new AppError(422, 'VALIDATION_ERROR', `Invalid status '${status}'`);
    }
    params.push(status);
    where = `WHERE status = $${params.length}`;
  }
  const result = await pool.query(
    `SELECT id, name, rule_set, description, source, status,
            paper_trading_results, discovered_at, activated_at, reviewed_by_admin
     FROM candidate_strategies
     ${where}
     ORDER BY discovered_at DESC`,
    params
  );
  return { data: result.rows };
}

async function patchCandidateStrategy(adminUserId, strategyId, patch) {
  const existing = await pool.query(
    `SELECT id, status, reviewed_by_admin FROM candidate_strategies WHERE id = $1`,
    [strategyId]
  );
  if (!existing.rows[0]) {
    throw new AppError(404, 'NOT_FOUND', 'Candidate strategy not found');
  }

  const sets = [];
  const params = [strategyId];
  if (patch.reviewed_by_admin !== undefined) {
    params.push(Boolean(patch.reviewed_by_admin));
    sets.push(`reviewed_by_admin = $${params.length}`);
  }
  if (patch.status !== undefined) {
    if (!STRATEGY_STATUSES.has(patch.status)) {
      throw new AppError(422, 'VALIDATION_ERROR', `Invalid status '${patch.status}'`);
    }
    params.push(patch.status);
    sets.push(`status = $${params.length}`);
    if (patch.status === 'active') {
      sets.push(`activated_at = COALESCE(activated_at, now())`);
    }
  }
  if (sets.length === 0) {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      'Provide reviewed_by_admin and/or status'
    );
  }

  const result = await pool.query(
    `UPDATE candidate_strategies
     SET ${sets.join(', ')}
     WHERE id = $1
     RETURNING id, name, rule_set, description, source, status,
               paper_trading_results, discovered_at, activated_at, reviewed_by_admin`,
    params
  );

  await writeAudit({
    adminUserId,
    action: 'candidate_strategy.update',
    details: { strategy_id: strategyId, patch },
  });

  return result.rows[0];
}

async function getSyntheticDemoDispatchStatus() {
  return syntheticDemoDispatchService.getDispatchStatus();
}

async function enableSyntheticDemoDispatch(adminUserId, minutes) {
  const status = await syntheticDemoDispatchService.enableDispatch(adminUserId, minutes);
  await writeAudit({
    adminUserId,
    action: 'synthetic_demo_dispatch.enable',
    details: { minutes, enabled_until: status.enabled_until },
  });
  return status;
}

async function disableSyntheticDemoDispatch(adminUserId) {
  const status = await syntheticDemoDispatchService.disableDispatch(adminUserId);
  await writeAudit({
    adminUserId,
    action: 'synthetic_demo_dispatch.disable',
  });
  return status;
}

async function getSyntheticDemoConfirmStatus() {
  return syntheticDemoDispatchService.getConfirmStatus();
}

async function enableSyntheticDemoConfirm(adminUserId, minutes) {
  const status = await syntheticDemoDispatchService.enableConfirm(adminUserId, minutes);
  await writeAudit({
    adminUserId,
    action: 'synthetic_demo_confirm.enable',
    details: { minutes, enabled_until: status.enabled_until },
  });
  return status;
}

async function disableSyntheticDemoConfirm(adminUserId) {
  const status = await syntheticDemoDispatchService.disableConfirm(adminUserId);
  await writeAudit({
    adminUserId,
    action: 'synthetic_demo_confirm.disable',
  });
  return status;
}

async function getSyntheticDemoManualTradeStatus() {
  return syntheticDemoDispatchService.getManualTestTradeStatus();
}

async function enableSyntheticDemoManualTrade(adminUserId, minutes) {
  const status = await syntheticDemoDispatchService.enableManualTestTrade(
    adminUserId,
    minutes
  );
  await writeAudit({
    adminUserId,
    action: 'synthetic_demo_manual_trade.enable',
    details: { minutes, enabled_until: status.enabled_until },
  });
  return status;
}

async function disableSyntheticDemoManualTrade(adminUserId) {
  const status = await syntheticDemoDispatchService.disableManualTestTrade(adminUserId);
  await writeAudit({
    adminUserId,
    action: 'synthetic_demo_manual_trade.disable',
  });
  return status;
}

async function getForexDemoDispatchStatus() {
  return forexDemoDispatchService.getDispatchStatus();
}

async function enableForexDemoDispatch(adminUserId, minutes) {
  const status = await forexDemoDispatchService.enableDispatch(adminUserId, minutes);
  await writeAudit({
    adminUserId,
    action: 'forex_demo_dispatch.enable',
    details: { minutes, enabled_until: status.enabled_until },
  });
  return status;
}

async function disableForexDemoDispatch(adminUserId) {
  const status = await forexDemoDispatchService.disableDispatch(adminUserId);
  await writeAudit({
    adminUserId,
    action: 'forex_demo_dispatch.disable',
  });
  return status;
}

async function getForexDemoConfirmStatus() {
  return forexDemoDispatchService.getConfirmStatus();
}

async function enableForexDemoConfirm(adminUserId, minutes) {
  const status = await forexDemoDispatchService.enableConfirm(adminUserId, minutes);
  await writeAudit({
    adminUserId,
    action: 'forex_demo_confirm.enable',
    details: { minutes, enabled_until: status.enabled_until },
  });
  return status;
}

async function disableForexDemoConfirm(adminUserId) {
  const status = await forexDemoDispatchService.disableConfirm(adminUserId);
  await writeAudit({
    adminUserId,
    action: 'forex_demo_confirm.disable',
  });
  return status;
}

async function getForexDemoManualTradeStatus() {
  return forexDemoDispatchService.getManualTestTradeStatus();
}

async function enableForexDemoManualTrade(adminUserId, minutes) {
  const status = await forexDemoDispatchService.enableManualTestTrade(
    adminUserId,
    minutes
  );
  await writeAudit({
    adminUserId,
    action: 'forex_demo_manual_trade.enable',
    details: { minutes, enabled_until: status.enabled_until },
  });
  return status;
}

async function disableForexDemoManualTrade(adminUserId) {
  const status = await forexDemoDispatchService.disableManualTestTrade(adminUserId);
  await writeAudit({
    adminUserId,
    action: 'forex_demo_manual_trade.disable',
  });
  return status;
}

function getM5PaperStatus() {
  return m5PaperHarness.getStatus();
}

async function startM5PaperSession(adminUserId) {
  const status = m5PaperHarness.start();
  await writeAudit({ adminUserId, action: 'm5_paper_experiment.start' });
  return status;
}

async function stopM5PaperSession(adminUserId) {
  const status = m5PaperHarness.stop();
  await writeAudit({ adminUserId, action: 'm5_paper_experiment.stop' });
  return status;
}

// ---------------------------------------------------------------------------
// M5 real-dispatch (UNPROVEN LIVE, docs/14_M5_Forex_Paper_Experiment.md) —
// admin-only, mirrors forex's confirm-live + demo-dispatch-toggle shape but
// fully independent state (bot_instances.m5_live_trading_confirmed_at,
// m5_demo_dispatch_config). See m5-real-harness.js's file header for the
// full safety-layer design before touching any of this.
// ---------------------------------------------------------------------------

function getM5RealStatus() {
  return m5RealHarness.getStatus();
}

async function startM5RealSession(adminUserId) {
  console.warn(
    `[admin] M5 REAL-DISPATCH session START requested by admin_user_id=${adminUserId} ` +
      '— UNPROVEN LIVE, testing-only'
  );
  const status = await m5RealHarness.start({ operatorUserId: adminUserId });
  await writeAudit({ adminUserId, action: 'm5_real_dispatch.start' });
  return status;
}

async function stopM5RealSession(adminUserId) {
  const status = await m5RealHarness.stop();
  await writeAudit({ adminUserId, action: 'm5_real_dispatch.stop' });
  return status;
}

/**
 * M5-specific confirm-live — independent of forex's confirmLiveTrading
 * (trading-engine.js) and synthetics'. Requires the M5 real harness to be
 * currently stopped (same "must be stopped before confirming" precondition
 * forex uses), the admin's own bot_instance to qualify (real account, or
 * demo with the M5 demo-confirm bypass enabled), and the exact phrase.
 */
async function confirmM5RealLiveTrading(adminUserId, confirmationPhrase) {
  const harnessStatus = m5RealHarness.getStatus();
  if (harnessStatus.status !== 'stopped') {
    throw new AppError(
      409,
      'INSTANCE_MUST_BE_STOPPED',
      'Stop the M5 real session before confirming live trading'
    );
  }

  const instance = await botInstanceRepository.ensureForUser(adminUserId);

  const demoAcceptanceAllowed = await m5DemoDispatchService.isM5DemoConfirmEnabled();
  const accountQualifies =
    instance.account_type === 'real' ||
    (demoAcceptanceAllowed && instance.account_type === 'demo');
  if (!accountQualifies) {
    throw new AppError(
      409,
      'NOT_A_REAL_ACCOUNT',
      'M5 live trading confirmation only applies to a real MT5 account (or demo with the M5 demo-confirm bypass enabled)'
    );
  }

  if (confirmationPhrase !== LIVE_TRADING_CONFIRMATION_PHRASE) {
    throw new AppError(400, 'CONFIRMATION_PHRASE_MISMATCH', 'Confirmation phrase does not match');
  }

  const updated = await botInstanceRepository.updateStatusFields(instance.id, {
    m5_live_trading_confirmed_at: new Date(),
  });
  console.warn(
    `[admin] M5 real-dispatch live trading CONFIRMED by admin_user_id=${adminUserId} ` +
      `bot_instance_id=${instance.id} account_type=${instance.account_type} — UNPROVEN LIVE`
  );
  await writeAudit({ adminUserId, action: 'm5_real_dispatch.confirm_live' });
  return {
    bot_instance_id: updated.id,
    account_type: instance.account_type,
    m5_live_trading_confirmed_at: updated.m5_live_trading_confirmed_at,
  };
}

function getM5RealDispatchStatus() {
  return m5DemoDispatchService.getDispatchStatus();
}

async function enableM5RealDispatch(adminUserId, minutes) {
  const status = await m5DemoDispatchService.enableDispatch(adminUserId, minutes);
  await writeAudit({
    adminUserId,
    action: 'm5_real_demo_dispatch.enable',
    details: { minutes, enabled_until: status.enabled_until },
  });
  return status;
}

async function disableM5RealDispatch(adminUserId) {
  const status = await m5DemoDispatchService.disableDispatch(adminUserId);
  await writeAudit({ adminUserId, action: 'm5_real_demo_dispatch.disable' });
  return status;
}

function getM5RealConfirmStatus() {
  return m5DemoDispatchService.getConfirmStatus();
}

async function enableM5RealConfirm(adminUserId, minutes) {
  const status = await m5DemoDispatchService.enableConfirm(adminUserId, minutes);
  await writeAudit({
    adminUserId,
    action: 'm5_real_demo_confirm.enable',
    details: { minutes, enabled_until: status.enabled_until },
  });
  return status;
}

async function disableM5RealConfirm(adminUserId) {
  const status = await m5DemoDispatchService.disableConfirm(adminUserId);
  await writeAudit({ adminUserId, action: 'm5_real_demo_confirm.disable' });
  return status;
}

module.exports = {
  listUsers,
  getUser,
  getSystemHealth,
  listRiskTiers,
  patchRiskTier,
  listCandidateStrategies,
  patchCandidateStrategy,
  getSyntheticDemoDispatchStatus,
  enableSyntheticDemoDispatch,
  disableSyntheticDemoDispatch,
  getSyntheticDemoConfirmStatus,
  enableSyntheticDemoConfirm,
  disableSyntheticDemoConfirm,
  getSyntheticDemoManualTradeStatus,
  enableSyntheticDemoManualTrade,
  disableSyntheticDemoManualTrade,
  getForexDemoDispatchStatus,
  enableForexDemoDispatch,
  disableForexDemoDispatch,
  getForexDemoConfirmStatus,
  enableForexDemoConfirm,
  disableForexDemoConfirm,
  getForexDemoManualTradeStatus,
  enableForexDemoManualTrade,
  disableForexDemoManualTrade,
  getM5PaperStatus,
  startM5PaperSession,
  stopM5PaperSession,
  getM5RealStatus,
  startM5RealSession,
  stopM5RealSession,
  confirmM5RealLiveTrading,
  getM5RealDispatchStatus,
  enableM5RealDispatch,
  disableM5RealDispatch,
  getM5RealConfirmStatus,
  enableM5RealConfirm,
  disableM5RealConfirm,
  writeAudit,
};
