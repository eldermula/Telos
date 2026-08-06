/**
 * Phase 2 broker-connections smoke test.
 * Uses placeholder password (attach-mode validates login match only).
 * Never prints credential secrets or encrypted blobs.
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const BASE = 'http://127.0.0.1:3000/api/v1';
const LOGIN = '5053904111';
const SERVER = 'MetaQuotes-Demo';
const PLACEHOLDER_PASSWORD = 'placeholder-not-the-real-mt5-password';

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertNoSecrets(obj) {
  const s = JSON.stringify(obj);
  assert(!/password/i.test(s) || !/"password"\s*:/.test(s), 'response leaked password field');
  assert(!/"credentials"\s*:/.test(s), 'response leaked credentials field');
  assert(!s.includes(PLACEHOLDER_PASSWORD), 'response leaked placeholder password value');
}

async function main() {
  const email = `broker_${Date.now()}@telos.test`;
  const password = 'Password123!';

  let r = await req('POST', '/auth/signup', { body: { email, password } });
  console.log('signup', r.status);
  assert(r.status === 201, `signup failed: ${JSON.stringify(r.json)}`);

  r = await req('POST', '/auth/login', { body: { email, password } });
  console.log('login', r.status);
  assert(r.status === 200 && r.json.token, 'login failed');
  const token = r.json.token;

  r = await req('GET', '/broker-connections', { token });
  console.log('list_empty', r.status, Array.isArray(r.json) ? `len=${r.json.length}` : r.json);
  assert(r.status === 200 && Array.isArray(r.json) && r.json.length === 0, 'expected empty list');

  r = await req('POST', '/broker-connections', {
    token,
    body: {
      broker_name: 'mt5',
      credentials: { login: LOGIN, password: PLACEHOLDER_PASSWORD, server: SERVER },
    },
  });
  console.log('create', r.status, r.json && {
    id: r.json.id,
    broker_name: r.json.broker_name,
    connection_status: r.json.connection_status,
  });
  assert(r.status === 201, `create failed: ${JSON.stringify(r.json)}`);
  assert(r.json.connection_status === 'connected', 'expected connected');
  assertNoSecrets(r.json);
  const id = r.json.id;

  r = await req('GET', '/broker-connections', { token });
  console.log('list_one', r.status, `len=${r.json.length}`, r.json[0] && r.json[0].connection_status);
  assert(r.status === 200 && r.json.length === 1, 'expected one connection');
  assertNoSecrets(r.json);

  r = await req('GET', `/broker-connections/${id}`, { token });
  console.log('get_by_id', r.status, r.json.connection_status);
  assert(r.status === 200 && r.json.id === id, 'get by id failed');
  assertNoSecrets(r.json);

  r = await req('POST', '/broker-connections', {
    token,
    body: {
      broker_name: 'mt5',
      credentials: { login: LOGIN, password: PLACEHOLDER_PASSWORD, server: SERVER },
    },
  });
  console.log('create_duplicate', r.status, r.json && r.json.error && r.json.error.code);
  assert(r.status === 409, 'expected 409 on second link');
  assert(r.json.error.code === 'CONNECTION_ALREADY_EXISTS', 'expected CONNECTION_ALREADY_EXISTS');

  r = await req('PATCH', `/broker-connections/${id}`, {
    token,
    body: {
      credentials: { login: LOGIN, password: PLACEHOLDER_PASSWORD, server: SERVER },
    },
  });
  console.log('patch', r.status, r.json.connection_status);
  assert(r.status === 200 && r.json.connection_status === 'connected', 'patch failed');
  assertNoSecrets(r.json);

  // Verify ciphertext at rest (no plaintext password in bytea as utf8)
  const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const db = await client.query(
    `SELECT octet_length(encrypted_credentials) AS n,
            position(convert_to($2, 'UTF8') in encrypted_credentials) AS pwd_pos
     FROM broker_connections WHERE id = $1`,
    [id, PLACEHOLDER_PASSWORD]
  );
  await client.end();
  const row = db.rows[0];
  console.log('encrypted_bytes', row.n);
  assert(Number(row.n) > 28, 'encrypted blob too short');
  assert(Number(row.pwd_pos) === 0, 'plaintext password found in DB blob');

  r = await req('DELETE', `/broker-connections/${id}`, { token });
  console.log('delete', r.status);
  assert(r.status === 204, 'delete failed');

  r = await req('GET', '/broker-connections', { token });
  console.log('list_after_delete', r.status, `len=${r.json.length}`);
  assert(r.status === 200 && r.json.length === 0, 'expected empty after delete');

  console.log('BROKER_CONNECTIONS_PASS');
}

main().catch((err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
