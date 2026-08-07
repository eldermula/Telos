/**
 * Phase 7.6 — Admin API smoke (users, health, risk-tiers, candidate-strategies + audit).
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcrypt'));
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const BASE = 'http://127.0.0.1:3000/api/v1';

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

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const stamp = Date.now();
  const adminEmail = `admin76_${stamp}@telos.test`;
  const userEmail = `user76_${stamp}@telos.test`;
  const password = 'Password123!';
  const passwordHash = await bcrypt.hash(password, 12);

  const adminId = (
    await client.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id`,
      [adminEmail, passwordHash]
    )
  ).rows[0].id;
  await client.query(`INSERT INTO settings (user_id) VALUES ($1)`, [adminId]);

  const userId = (
    await client.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`,
      [userEmail, passwordHash]
    )
  ).rows[0].id;
  await client.query(`INSERT INTO settings (user_id) VALUES ($1)`, [userId]);

  let r = await req('POST', '/auth/login', { body: { email: userEmail, password } });
  assert(r.status === 200 && r.json.token, `user login failed: ${JSON.stringify(r.json)}`);
  const userToken = r.json.token;

  r = await req('GET', '/admin/users', { token: userToken });
  assert(r.status === 403 && r.json.error.code === 'FORBIDDEN', 'non-admin must get 403');

  r = await req('POST', '/auth/login', { body: { email: adminEmail, password } });
  assert(r.status === 200 && r.json.token, `admin login failed: ${JSON.stringify(r.json)}`);
  const adminToken = r.json.token;

  r = await req('GET', '/admin/users', { token: adminToken });
  assert(r.status === 200 && Array.isArray(r.json.data), 'list users');
  assert(r.json.data.some((u) => u.id === userId), 'seeded user missing');

  r = await req('GET', `/admin/users/${userId}`, { token: adminToken });
  assert(r.status === 200 && r.json.id === userId, 'user detail');
  assert(!('password_hash' in r.json), 'password_hash must never leak');

  r = await req('GET', '/admin/system-health', { token: adminToken });
  assert(r.status === 200 && r.json.postgres && r.json.redis, 'system-health shape');
  assert(r.json.status === 'ok' || r.json.status === 'degraded', 'status enum');

  r = await req('GET', '/admin/risk-tiers', { token: adminToken });
  assert(r.status === 200 && r.json.data.length === 8, 'expect 8 risk tiers');
  const tier0 = r.json.data.find((t) => t.tier === 0);
  assert(tier0, 'tier 0');
  const originalCeiling = tier0.max_risk_ceiling;

  r = await req('PATCH', '/admin/risk-tiers/0', {
    token: adminToken,
    body: { max_risk_ceiling: Number(originalCeiling) },
  });
  assert(r.status === 200 && r.json.tier === 0, `patch tier failed: ${JSON.stringify(r.json)}`);

  const audit = await client.query(
    `SELECT action FROM admin_audit_log
     WHERE admin_user_id = $1 AND action LIKE 'risk_tier.update%'
     ORDER BY timestamp DESC LIMIT 1`,
    [adminId]
  );
  assert(audit.rows[0], 'risk tier write must audit');

  r = await req('GET', '/admin/candidate-strategies?status=active', { token: adminToken });
  assert(r.status === 200 && r.json.data.length >= 1, 'active strategies');
  const strategyId = r.json.data[0].id;

  r = await req('PATCH', `/admin/candidate-strategies/${strategyId}`, {
    token: adminToken,
    body: { reviewed_by_admin: true },
  });
  assert(r.status === 200 && r.json.reviewed_by_admin === true, 'strategy review');

  const audit2 = await client.query(
    `SELECT action FROM admin_audit_log
     WHERE admin_user_id = $1 AND action LIKE 'candidate_strategy.update%'
     ORDER BY timestamp DESC LIMIT 1`,
    [adminId]
  );
  assert(audit2.rows[0], 'strategy write must audit');

  await client.end();
  console.log('ADMIN_76_PASS');
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
