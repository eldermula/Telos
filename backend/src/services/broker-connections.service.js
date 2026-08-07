const { pool } = require('../db/pool');
const { AppError } = require('../utils/app-error');
const { encryptCredentials } = require('./credential-crypto.service');
const { validateBrokerCredentials } = require('./mt5-connector.client');

function toPublicConnection(row) {
  return {
    id: row.id,
    broker_name: row.broker_name,
    connection_status: row.connection_status,
    // 08_Bot_Architecture.md §13 / 09_Security.md §11 — system-detected
    // from MT5 at validate time (never user-supplied); surfaced here so
    // the user can see whether the linked account is demo/contest/real,
    // not just hidden as an internal-only field.
    account_type: row.account_type,
    linked_at: row.linked_at,
    last_validated_at: row.last_validated_at,
  };
}

async function listConnections(userId) {
  const result = await pool.query(
    `SELECT id, broker_name, connection_status, account_type, linked_at, last_validated_at
     FROM broker_connections
     WHERE user_id = $1
     ORDER BY linked_at ASC`,
    [userId]
  );
  return result.rows.map(toPublicConnection);
}

async function getConnection(userId, id) {
  const result = await pool.query(
    `SELECT id, broker_name, connection_status, account_type, linked_at, last_validated_at
     FROM broker_connections
     WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'Broker connection not found');
  }
  return toPublicConnection(row);
}

async function createConnection(userId, { broker_name, credentials }) {
  const existing = await pool.query(
    `SELECT id FROM broker_connections WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  if (existing.rows.length > 0) {
    throw new AppError(
      409,
      'CONNECTION_ALREADY_EXISTS',
      'A broker connection already exists for this account'
    );
  }

  const validation = await validateBrokerCredentials(credentials);
  const encrypted = encryptCredentials({
    login: String(credentials.login),
    password: credentials.password,
    server: credentials.server,
  });

  const result = await pool.query(
    `INSERT INTO broker_connections
       (user_id, broker_name, encrypted_credentials, connection_status, account_type, linked_at, last_validated_at)
     VALUES ($1, $2, $3, $4, $5, now(), now())
     RETURNING id, broker_name, connection_status, account_type, linked_at, last_validated_at`,
    [userId, broker_name, encrypted, validation.connection_status, validation.account_type]
  );

  return toPublicConnection(result.rows[0]);
}

async function updateConnection(userId, id, { credentials }) {
  const existing = await pool.query(
    `SELECT id FROM broker_connections WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!existing.rows[0]) {
    throw new AppError(404, 'NOT_FOUND', 'Broker connection not found');
  }

  const validation = await validateBrokerCredentials(credentials);
  const encrypted = encryptCredentials({
    login: String(credentials.login),
    password: credentials.password,
    server: credentials.server,
  });

  const result = await pool.query(
    `UPDATE broker_connections
     SET encrypted_credentials = $1,
         connection_status = $2,
         account_type = $3,
         last_validated_at = now()
     WHERE id = $4 AND user_id = $5
     RETURNING id, broker_name, connection_status, account_type, linked_at, last_validated_at`,
    [encrypted, validation.connection_status, validation.account_type, id, userId]
  );

  return toPublicConnection(result.rows[0]);
}

async function deleteConnection(userId, id) {
  const result = await pool.query(
    `DELETE FROM broker_connections
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [id, userId]
  );
  if (!result.rows[0]) {
    throw new AppError(404, 'NOT_FOUND', 'Broker connection not found');
  }
}

module.exports = {
  listConnections,
  getConnection,
  createConnection,
  updateConnection,
  deleteConnection,
};
