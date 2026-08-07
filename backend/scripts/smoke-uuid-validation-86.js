/**
 * Phase 8.6 smoke — UUID path-param Zod (group A).
 * Invalid :id must 422 VALIDATION_ERROR, never reach Postgres as a 500.
 *
 * Gate is off when ACCESS_GATE_* unset on the already-running server.
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcrypt'));
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const BASE = 'http://127.0.0.1:3000/api/v1';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

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

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const stamp = Date.now();
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  const adminEmail = `uuid86_admin_${stamp}@telos.test`;
  const userEmail = `uuid86_user_${stamp}@telos.test`;
  const adminId = (
    await client.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id`,
      [adminEmail, hash]
    )
  ).rows[0].id;
  await client.query(`INSERT INTO settings (user_id) VALUES ($1)`, [adminId]);
  const userId = (
    await client.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`,
      [userEmail, hash]
    )
  ).rows[0].id;
  await client.query(`INSERT INTO settings (user_id) VALUES ($1)`, [userId]);

  try {
    const adminLogin = await req('POST', '/auth/login', { body: { email: adminEmail, password } });
    assert(adminLogin.status === 200, `admin login failed: ${JSON.stringify(adminLogin.json)}`);
    const adminToken = adminLogin.json.token;

    const userLogin = await req('POST', '/auth/login', { body: { email: userEmail, password } });
    assert(userLogin.status === 200, `user login failed: ${JSON.stringify(userLogin.json)}`);
    const userToken = userLogin.json.token;

    const bad = 'not-a-uuid';
    const cases = [
      ['PATCH', `/notifications/${bad}`, userToken, { read_status: true }],
      ['GET', `/reports/${bad}`, userToken, null],
      ['GET', `/reports/${bad}/download`, userToken, null],
      ['GET', `/admin/users/${bad}`, adminToken, null],
      ['PATCH', `/admin/candidate-strategies/${bad}`, adminToken, { reviewed_by_admin: true }],
      ['GET', `/assistant/conversations/${bad}/messages`, userToken, null],
      ['POST', `/assistant/conversations/${bad}/messages`, userToken, { content: 'hi' }],
    ];

    for (const [method, url, token, body] of cases) {
      const r = await req(method, url, { token, body: body || undefined });
      assert(
        r.status === 422 && r.json?.error?.code === 'VALIDATION_ERROR',
        `${method} ${url} expected 422 VALIDATION_ERROR, got ${r.status} ${JSON.stringify(r.json)}`
      );
      console.log('ok', method, url);
    }

    console.log('UUID_VALIDATION_86_PASS');
  } finally {
    await client.query(`DELETE FROM users WHERE id IN ($1, $2)`, [adminId, userId]);
    await client.end();
  }
}

main().catch((err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
