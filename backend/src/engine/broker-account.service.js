'use strict';

/**
 * Option 2 E.3 — shared login-matched live account-info read.
 * Used by GET /trading/account-info (Confirm Live modal) and by
 * BotRuntime real-mode paths (E.5+) so the decrypt + login-match
 * guard cannot drift between them.
 */

const { pool } = require('../db/pool');
const { decryptCredentials } = require('../services/credential-crypto.service');
const { getAccountInfo } = require('../services/mt5-connector.client');
const { AppError } = require('../utils/app-error');

function toPublicAccountInfo(row, info) {
  return {
    broker_connection_id: row.id,
    broker_name: row.broker_name,
    login: info.login,
    // Live from the terminal, not the (possibly stale) DB column.
    account_type: info.account_type,
    balance: info.balance,
    equity: info.equity,
    currency: info.currency ?? null,
    last_validated_at: row.last_validated_at,
  };
}

async function fetchMatchedAccountInfoFromRow(row) {
  const credentials = decryptCredentials(row.encrypted_credentials);
  const expectedLogin = String(credentials.login).trim();

  const info = await getAccountInfo();
  if (String(info.login) !== expectedLogin) {
    throw new AppError(
      422,
      'BROKER_ACCOUNT_MISMATCH',
      'Attached MT5 account login does not match your linked broker connection'
    );
  }
  return toPublicAccountInfo(row, info);
}

async function getMatchedAccountInfoForUser(userId) {
  const result = await pool.query(
    `SELECT id, broker_name, account_type, encrypted_credentials, last_validated_at
     FROM broker_connections
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(
      404,
      'NO_BROKER_CONNECTION',
      'Link a broker connection before reading live account info'
    );
  }
  return fetchMatchedAccountInfoFromRow(row);
}

async function getMatchedAccountInfoForBotInstance(botInstanceId) {
  const result = await pool.query(
    `SELECT bc.id, bc.broker_name, bc.account_type, bc.encrypted_credentials, bc.last_validated_at
     FROM bot_instances bi
     JOIN broker_connections bc ON bc.id = bi.broker_connection_id
     WHERE bi.id = $1`,
    [botInstanceId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'BOT_INSTANCE_NOT_FOUND', 'Bot instance not found');
  }
  return fetchMatchedAccountInfoFromRow(row);
}

module.exports = {
  getMatchedAccountInfoForUser,
  getMatchedAccountInfoForBotInstance,
};
