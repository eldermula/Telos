'use strict';

const { pool } = require('../db/pool');
const { AppError } = require('../utils/app-error');
const { toMeta } = require('../utils/pagination');
const settingsService = require('./settings.service');

async function listNotifications(userId, { limit = 25, offset = 0, page = 1 } = {}) {
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT id, type, message, read_status, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1`, [userId]),
  ]);
  return {
    data: rows.rows.map((row) => ({
      id: row.id,
      type: row.type,
      message: row.message,
      read_status: row.read_status,
      created_at: row.created_at,
    })),
    meta: toMeta({ page, limit }, count.rows[0].n),
  };
}

async function updateReadStatus(userId, notificationId, readStatus) {
  const result = await pool.query(
    `UPDATE notifications
     SET read_status = $3
     WHERE id = $1 AND user_id = $2
     RETURNING id, type, message, read_status, created_at`,
    [notificationId, userId, readStatus]
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'Notification not found');
  }
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    read_status: row.read_status,
    created_at: row.created_at,
  };
}

/**
 * Creates a notification if the user's preference for `type` is enabled.
 * Never throws into the trading hot path — preference lookup / insert
 * failures are logged and swallowed so a notifications outage cannot
 * block Start/Stop or strategy switches.
 */
async function insertNotification(userId, type, message) {
  const result = await pool.query(
    `INSERT INTO notifications (user_id, type, message)
     VALUES ($1, $2, $3)
     RETURNING id, type, message, read_status, created_at`,
    [userId, type, message]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    read_status: row.read_status,
    created_at: row.created_at,
  };
}

async function maybeNotifyUser(userId, type, message) {
  try {
    const { preferences } = await settingsService.getNotificationPreferences(userId);
    if (preferences[type] !== true) {
      return null;
    }
    return await insertNotification(userId, type, message);
  } catch (err) {
    console.error('[notifications]', err.message);
    return null;
  }
}

/**
 * Option 2 E.3 — real-money events must always reach the user.
 * Skips preference gating; still swallows insert failures so a
 * notifications outage cannot block the trading hot path.
 */
async function forceNotifyUser(userId, type, message) {
  try {
    return await insertNotification(userId, type, message);
  } catch (err) {
    console.error('[notifications] forceNotify failed:', err.message);
    return null;
  }
}

module.exports = {
  listNotifications,
  updateReadStatus,
  maybeNotifyUser,
  forceNotifyUser,
};
