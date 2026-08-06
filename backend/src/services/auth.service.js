const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool } = require('../db/pool');
const { redis } = require('../db/redis');
const {
  BCRYPT_ROUNDS,
  PASSWORD_RESET_TTL_SECONDS,
} = require('../config/env');
const { AppError } = require('../utils/app-error');
const {
  signToken,
  blacklistToken,
  parseExpiryToSeconds,
} = require('./session.service');
const { JWT_EXPIRES_IN } = require('../config/env');
const { sendPasswordResetEmail } = require('./email.service');

async function signup({ email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const insertUser = await client.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'user')
       RETURNING id, email, role`,
      [normalizedEmail, passwordHash]
    );
    const user = insertUser.rows[0];
    await client.query(
      `INSERT INTO settings (user_id, notification_preferences)
       VALUES ($1, '{}'::jsonb)`,
      [user.id]
    );
    await client.query('COMMIT');
    return { user: { id: user.id, email: user.email, role: user.role } };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'An account with that email already exists');
    }
    throw err;
  } finally {
    client.release();
  }
}

async function login({ email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  const result = await pool.query(
    `SELECT id, email, role, password_hash FROM users WHERE email = $1`,
    [normalizedEmail]
  );
  const user = result.rows[0];
  if (!user) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const { token } = signToken(user);
  return {
    token,
    user: { id: user.id, email: user.email, role: user.role },
  };
}

async function logout(userId, jti, exp) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const remaining = exp ? exp - nowSeconds : parseExpiryToSeconds(JWT_EXPIRES_IN);
  await blacklistToken(userId, jti, remaining);
}

async function requestPasswordReset(email) {
  const normalizedEmail = email.trim().toLowerCase();
  const result = await pool.query(
    `SELECT id, email FROM users WHERE email = $1`,
    [normalizedEmail]
  );
  const user = result.rows[0];

  // Always return the same message — no user enumeration (06 Section 3)
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const key = `password_reset:${token}`;
    await redis.set(key, user.id, 'EX', PASSWORD_RESET_TTL_SECONDS);
    await sendPasswordResetEmail(user.email, token);
  }

  return {
    message: 'If that email exists, a reset link was sent.',
  };
}

async function confirmPasswordReset({ token, password }) {
  const key = `password_reset:${token}`;
  const userId = await redis.get(key);
  if (!userId) {
    throw new AppError(400, 'INVALID_RESET_TOKEN', 'Invalid or expired reset token');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await pool.query(
    `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`,
    [passwordHash, userId]
  );
  await redis.del(key);

  return { message: 'Password updated.' };
}

async function getMe(userId) {
  const result = await pool.query(
    `SELECT id, email, role, created_at FROM users WHERE id = $1`,
    [userId]
  );
  const user = result.rows[0];
  if (!user) {
    throw new AppError(401, 'UNAUTHORIZED', 'User not found');
  }
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
  };
}

module.exports = {
  signup,
  login,
  logout,
  requestPasswordReset,
  confirmPasswordReset,
  getMe,
};
