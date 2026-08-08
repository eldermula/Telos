'use strict';

const { pool } = require('../db/pool');

async function insertDecision({
  botInstanceId,
  decisionType,
  triggeringCondition,
  details = {},
  timestamp = new Date(),
  assetClass = 'forex_gold',
}) {
  const result = await pool.query(
    `INSERT INTO bot_decision_log
       (bot_instance_id, timestamp, decision_type, triggering_condition, details, asset_class)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id, bot_instance_id, timestamp, decision_type, triggering_condition, details, asset_class`,
    [
      botInstanceId,
      timestamp,
      decisionType,
      triggeringCondition,
      JSON.stringify(details),
      assetClass,
    ]
  );
  return result.rows[0];
}

async function listRecent(botInstanceId, { limit = 50 } = {}) {
  const result = await pool.query(
    `SELECT id, bot_instance_id, timestamp, decision_type, triggering_condition, details
     FROM bot_decision_log
     WHERE bot_instance_id = $1
     ORDER BY timestamp DESC
     LIMIT $2`,
    [botInstanceId, limit]
  );
  return result.rows;
}

/**
 * GET /trading/decision-log (06 Section 6) — paginated read of
 * bot_decision_log, satisfying FR-BOT-6 / NFR-6.
 */
async function listPaginated(botInstanceId, { limit = 25, offset = 0 } = {}) {
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT id, bot_instance_id, timestamp, decision_type, triggering_condition, details
       FROM bot_decision_log
       WHERE bot_instance_id = $1
       ORDER BY timestamp DESC
       LIMIT $2 OFFSET $3`,
      [botInstanceId, limit, offset]
    ),
    pool.query(
      `SELECT count(*)::int AS n FROM bot_decision_log WHERE bot_instance_id = $1`,
      [botInstanceId]
    ),
  ]);
  return { rows: rows.rows, total: count.rows[0].n };
}

module.exports = {
  insertDecision,
  listRecent,
  listPaginated,
};
