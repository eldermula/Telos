'use strict';

const { pool } = require('../db/pool');
const { redis } = require('../db/redis');
const { AppError } = require('../utils/app-error');
const { toMeta } = require('../utils/pagination');

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

module.exports = {
  listUsers,
  getUser,
  getSystemHealth,
  listRiskTiers,
  patchRiskTier,
  listCandidateStrategies,
  patchCandidateStrategy,
  writeAudit,
};
