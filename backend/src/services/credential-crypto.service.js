const crypto = require('crypto');
const { BROKER_CREDENTIALS_KEY } = require('../config/env');
const { AppError } = require('../utils/app-error');

/**
 * Field-level AES-256-GCM for broker_connections.encrypted_credentials.
 * Key: BROKER_CREDENTIALS_KEY (base64-encoded 32 bytes) from .env — 05 §4 / 09 §3.
 * Wire format (BYTEA): [12-byte IV][16-byte auth tag][ciphertext]
 */

function getKey() {
  if (!BROKER_CREDENTIALS_KEY) {
    throw new AppError(
      500,
      'INTERNAL_ERROR',
      'BROKER_CREDENTIALS_KEY is not configured'
    );
  }
  let key;
  try {
    key = Buffer.from(BROKER_CREDENTIALS_KEY, 'base64');
  } catch {
    throw new AppError(500, 'INTERNAL_ERROR', 'BROKER_CREDENTIALS_KEY is invalid');
  }
  if (key.length !== 32) {
    throw new AppError(
      500,
      'INTERNAL_ERROR',
      'BROKER_CREDENTIALS_KEY must decode to 32 bytes (AES-256)'
    );
  }
  return key;
}

function encryptCredentials(credentials) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(credentials), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function decryptCredentials(blob) {
  const key = getKey();
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buf.length < 12 + 16 + 1) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Corrupt encrypted credentials');
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

module.exports = { encryptCredentials, decryptCredentials };
