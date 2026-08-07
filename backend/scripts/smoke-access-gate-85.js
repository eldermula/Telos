/**
 * Phase 8.5 smoke — site-wide access gate.
 *
 * Spawns the backend with ACCESS_GATE_* set for this process only (does
 * not mutate backend/.env), then asserts:
 *   - /health stays ungated
 *   - authenticated routes 403 GATE_LOCKED without cookie
 *   - wrong phrase → 401
 *   - punctuation/case variant of the phrase → 204 + Set-Cookie
 *   - subsequent request with Cookie → 200 on a gated route
 *   - GET /access-gate/status reflects unlocked
 *
 * Does not require Postgres/Redis beyond whatever /auth/me needs after
 * unlock — uses /settings/profile for the gated check so we need a real
 * user JWT. Creates a throwaway user via admin-free signup (also gated
 * until unlock).
 */
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const BASE = 'http://127.0.0.1:3010';
const API = `${BASE}/api/v1`;

const PHRASE =
  'Do not remember the former things, Nor consider the things of old. Behold, I will do a new thing, Now it shall spring forth; Shall you not know it? I will even make a road in the wilderness And rivers in the desert.';
const SECRET = crypto.randomBytes(32).toString('base64');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function req(method, url, { token, cookie, body, rawUrl } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(rawUrl || `${API}${url}`, {
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
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, json, setCookie, headers: res.headers };
}

function extractGateCookie(setCookie) {
  for (const line of setCookie) {
    const m = /^telos_gate=([^;]+)/.exec(line);
    if (m) return `telos_gate=${m[1]}`;
  }
  return null;
}

async function waitHealthy(child, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode != null) {
      throw new Error(`server exited early with code ${child.exitCode}`);
    }
    try {
      const r = await req('GET', '', { rawUrl: `${BASE}/health` });
      if (r.status === 200 && r.json && r.json.status === 'ok') return;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  throw new Error('server did not become healthy in time');
}

async function main() {
  // Reuse the developer's .env for DATABASE_URL/JWT_SECRET/etc, override
  // only PORT + gate vars for this isolated server.
  require(path.join(ROOT, 'node_modules', 'dotenv')).config({
    path: path.join(ROOT, '.env'),
  });

  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: '3010',
      NODE_ENV: 'development',
      ACCESS_GATE_PHRASE: PHRASE,
      ACCESS_GATE_SECRET: SECRET,
      ACCESS_GATE_TTL_DAYS: '30',
      ACCESS_GATE_COOKIE_NAME: 'telos_gate',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    stdout += d.toString();
    process.stdout.write(`[gate-server] ${d}`);
  });
  child.stderr.on('data', (d) => {
    stderr += d.toString();
    process.stderr.write(`[gate-server:err] ${d}`);
  });

  try {
    await waitHealthy(child, 45000);
    console.log('server_up_on_3010');

    const health = await req('GET', '', { rawUrl: `${BASE}/health` });
    assert(health.status === 200 && health.json.status === 'ok', 'GET /health must stay ungated');
    console.log('HEALTH_UNGATED_CONFIRMED');

    const locked = await req('GET', '/settings/profile');
    assert(locked.status === 403, `expected GATE_LOCKED 403, got ${locked.status}`);
    assert(locked.json?.error?.code === 'GATE_LOCKED', `expected GATE_LOCKED code: ${JSON.stringify(locked.json)}`);
    console.log('GATED_ROUTE_LOCKED_CONFIRMED');

    const statusLocked = await req('GET', '/access-gate/status');
    assert(statusLocked.status === 200, 'status must be reachable');
    assert(statusLocked.json.configured === true && statusLocked.json.unlocked === false, 'status should show locked');

    const wrong = await req('POST', '/access-gate/verify', { body: { attempt: 'wrong phrase entirely' } });
    assert(wrong.status === 401, `expected 401 on wrong phrase, got ${wrong.status}`);
    console.log('WRONG_PHRASE_DENIED');

    // Punctuation / casing variant of the same verse — normalization must accept it.
    const variant =
      'DO NOT REMEMBER THE FORMER THINGS!!! nor consider the things of old... Behold, I will do a new thing; Now it shall spring forth; Shall you not know it? I will even make a road in the wilderness, And rivers in the desert.';
    const ok = await req('POST', '/access-gate/verify', { body: { attempt: variant } });
    assert(ok.status === 204, `expected 204 on correct phrase, got ${ok.status} ${JSON.stringify(ok.json)}`);
    const cookie = extractGateCookie(ok.setCookie);
    assert(cookie, `expected telos_gate Set-Cookie, got: ${JSON.stringify(ok.setCookie)}`);
    console.log('VERIFY_SETS_COOKIE_CONFIRMED');

    const statusOpen = await req('GET', '/access-gate/status', { cookie });
    assert(statusOpen.json.unlocked === true, 'status should show unlocked with cookie');

    // Signup + login behind the gate to exercise a normal authenticated path.
    const stamp = Date.now();
    const email = `gate85_${stamp}@telos.test`;
    const password = 'Password123!';
    const signup = await req('POST', '/auth/signup', {
      cookie,
      body: { email, password },
    });
    assert(signup.status === 201, `signup failed: ${JSON.stringify(signup.json)}`);
    const login = await req('POST', '/auth/login', {
      cookie,
      body: { email, password },
    });
    assert(login.status === 200 && login.json.token, `login failed: ${JSON.stringify(login.json)}`);
    const token = login.json.token;

    const profile = await req('GET', '/settings/profile', { cookie, token });
    assert(profile.status === 200, `gated+auth profile should 200, got ${profile.status} ${JSON.stringify(profile.json)}`);
    console.log('GATED_ROUTE_UNLOCKED_CONFIRMED');

    // Cleanup throwaway user created during this smoke.
    const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(`DELETE FROM users WHERE email = $1`, [email]);
    await client.end();

    console.log('ACCESS_GATE_85_PASS');
  } finally {
    child.kill('SIGTERM');
    await sleep(500);
    if (child.exitCode == null) child.kill('SIGKILL');
    if (stderr) {
      // keep quiet unless failing
    }
  }
}

main().catch((err) => {
  console.error('FAIL', err.message);
  console.error(err.stack);
  process.exit(1);
});
