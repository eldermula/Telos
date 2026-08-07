/**
 * Phase 7.5 — Reports API smoke (CSV path; PDF flagged as not implemented).
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

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
  return { status: res.status, json, text, headers: res.headers };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  // Clear login rate limit so repeated autonomous runs stay reliable.
  try {
    const { redis } = require('../src/db/redis');
    const { connectRedis } = require('../src/db/redis');
    await connectRedis();
    await redis.del('ratelimit:::ffff:127.0.0.1:/auth/login');
  } catch {
    /* ignore */
  }

  const email = `reports75_${Date.now()}@telos.test`;
  const password = 'Password123!';
  let r = await req('POST', '/auth/signup', { body: { email, password } });
  assert(r.status === 201, `signup failed: ${JSON.stringify(r.json)}`);
  r = await req('POST', '/auth/login', { body: { email, password } });
  assert(r.status === 200 && r.json.token, `login failed: ${JSON.stringify(r.json)}`);
  const token = r.json.token;

  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  r = await req('POST', '/reports', {
    token,
    body: { period_start: start, period_end: today, format: 'pdf' },
  });
  assert(r.status === 422 && r.json.error.code === 'PDF_NOT_IMPLEMENTED', 'pdf should be flagged unimplemented');

  r = await req('POST', '/reports', {
    token,
    body: { period_start: start, period_end: today, format: 'csv' },
  });
  console.log('create', r.status, r.json);
  assert(r.status === 201, `create failed: ${JSON.stringify(r.json)}`);
  assert(r.json.format === 'csv', 'format');
  const id = r.json.id;

  r = await req('GET', '/reports', { token });
  assert(r.status === 200 && r.json.data.some((row) => row.id === id), 'list missing report');

  r = await req('GET', `/reports/${id}`, { token });
  assert(r.status === 200 && r.json.id === id, 'get failed');

  r = await req('GET', `/reports/${id}/download`, { token });
  assert(r.status === 200, `download failed: ${r.status}`);
  assert(String(r.text).includes('id,symbol,direction'), 'csv header missing');

  console.log('REPORTS_75_PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
