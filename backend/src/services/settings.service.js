'use strict';

/**
 * Settings (06_API_Specification.md §12 / FR-SET-1, FR-SET-3).
 *
 * Profile lives on `users` (email). Notification preferences live on
 * `settings.notification_preferences` jsonb. Broker connection management
 * stays under `/broker-connections` — not duplicated here.
 *
 * Preference keys mirror the `notification_type` enum in
 * `001_initial_schema.sql`. Spec did not define a concrete shape beyond
 * "jsonb" — this is the confirmed working contract for Phase 7.1.
 */

const bcrypt = require('bcrypt');
const { pool } = require('../db/pool');
const { BCRYPT_ROUNDS } = require('../config/env');
const { AppError } = require('../utils/app-error');

const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  bot_start: true,
  bot_stop: true,
  connection_error: true,
  trading_error: true,
  strategy_switch: true,
  // Option 2 Increment D — Layer 2 confirm-live. Defaults on: this is a
  // real-money safety event, not routine noise, so it shouldn't require
  // an opt-in the user might never think to flip.
  live_trading_confirmed: true,
  // Option 2 E.3 — real order place/fail/close. Defaults on; E.5+ also
  // force-notifies so preference cannot silence a real-money event.
  real_order: true,
});

const PREFERENCE_KEYS = Object.keys(DEFAULT_NOTIFICATION_PREFERENCES);

function mergePreferences(stored) {
  const base = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return base;
  }
  for (const key of PREFERENCE_KEYS) {
    if (typeof stored[key] === 'boolean') {
      base[key] = stored[key];
    }
  }
  return base;
}

async function getProfile(userId) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.role, u.created_at, u.updated_at AS user_updated_at,
            s.updated_at AS settings_updated_at
     FROM users u
     LEFT JOIN settings s ON s.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'User not found');
  }
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    created_at: row.created_at,
    updated_at: row.user_updated_at,
  };
}

async function updateProfile(userId, { email, current_password, new_password }) {
  if (email === undefined && new_password === undefined) {
    throw new AppError(422, 'VALIDATION_ERROR', 'No profile fields to update');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id, email, password_hash FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    const user = existing.rows[0];
    if (!user) {
      throw new AppError(404, 'NOT_FOUND', 'User not found');
    }

    if (new_password !== undefined) {
      if (!current_password) {
        throw new AppError(
          422,
          'VALIDATION_ERROR',
          'current_password is required to set a new password'
        );
      }
      const matches = await bcrypt.compare(current_password, user.password_hash);
      if (!matches) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
      }
      const passwordHash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
      await client.query(
        `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`,
        [userId, passwordHash]
      );
    }

    if (email !== undefined) {
      const normalized = email.trim().toLowerCase();
      try {
        await client.query(
          `UPDATE users SET email = $2, updated_at = now() WHERE id = $1`,
          [userId, normalized]
        );
      } catch (err) {
        if (err.code === '23505') {
          throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'An account with that email already exists');
        }
        throw err;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getProfile(userId);
}

async function getNotificationPreferences(userId) {
  const result = await pool.query(
    `SELECT notification_preferences, updated_at FROM settings WHERE user_id = $1`,
    [userId]
  );
  let row = result.rows[0];
  if (!row) {
    // Signup always creates a settings row; self-heal if somehow missing.
    await pool.query(
      `INSERT INTO settings (user_id, notification_preferences)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, JSON.stringify(DEFAULT_NOTIFICATION_PREFERENCES)]
    );
    const created = await pool.query(
      `SELECT notification_preferences, updated_at FROM settings WHERE user_id = $1`,
      [userId]
    );
    row = created.rows[0];
  }
  return {
    preferences: mergePreferences(row.notification_preferences),
    updated_at: row.updated_at,
  };
}

async function updateNotificationPreferences(userId, preferences) {
  const merged = mergePreferences(preferences);
  const result = await pool.query(
    `INSERT INTO settings (user_id, notification_preferences, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE
       SET notification_preferences = $2::jsonb, updated_at = now()
     RETURNING notification_preferences, updated_at`,
    [userId, JSON.stringify(merged)]
  );
  return {
    preferences: mergePreferences(result.rows[0].notification_preferences),
    updated_at: result.rows[0].updated_at,
  };
}

module.exports = {
  DEFAULT_NOTIFICATION_PREFERENCES,
  PREFERENCE_KEYS,
  getProfile,
  updateProfile,
  getNotificationPreferences,
  updateNotificationPreferences,
};
