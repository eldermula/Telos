/**
 * Phase 8.5 smoke — WebSocket leg of the site-wide access gate.
 *
 * smoke-access-gate-85.js only exercises REST. This one proves the
 * check documented in websocket-server.js's `wss.on('connection', ...)`
 * handler actually rejects sockets, not just that the code exists:
 *
 *   - no Cookie header at all           -> close code 4403
 *   - Cookie present but garbage/tampered token -> close code 4403
 *   - valid telos_gate cookie + valid ?token=   -> connection.ready, stays open
 *
 * Spawns the backend the same way smoke-access-gate-85.js does (isolated
 * port + gate env, does not touch backend/.env).
 */
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const BASE = 'http://127.0.0.1:3011';
const WS_BASE = 'ws://127.0.0.1:3011';
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
  return { status: res.status, json, setCookie };
}

function extractGateCookie(setCookie) {
  for (const line of setCookie) {
    const m = /^telos_gate=([^;]+)/.exec(line);
    if (m) return `telos_gate=${m[1]}`;
  }
  return null;
}

async function waitHealthy(child, timeoutMs = 45000) {
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

/**
 * Opens a raw WS connection with the given extra headers and waits up to
 * timeoutMs for the server to act. The gate handler sends a
 * `connection.error` message *then* closes the socket (see closeWithError
 * in websocket-server.js), so "rejected" must be judged by the `close`
 * event, not by the first message — a message alone doesn't prove the
 * connection was terminated. Resolves with:
 *   - { closed: true, code, reason, messages }  if the server closed it
 *   - { closed: false, messages }                if still open at timeout
 */
function tryConnect(headers, { timeoutMs = 4000, path: wsPath = '/ws' } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}${wsPath}`, { headers });
    let settled = false;
    const messages = [];

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.terminate();
      resolve({ closed: false, messages });
    }, timeoutMs);

    ws.on('close', (code, reasonBuf) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ closed: true, code, reason: reasonBuf ? reasonBuf.toString() : '', messages });
    });

    ws.on('message', (data) => {
      let parsed = null;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        /* ignore */
      }
      messages.push(parsed);
      // For the accepted case there's nothing further to wait for once
      // connection.ready arrives and no close follows — stop early so the
      // smoke doesn't sit for the full timeout on the happy path.
      if (parsed && parsed.event === 'connection.ready' && !settled) {
        setTimeout(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ws.close();
          resolve({ closed: false, messages });
        }, 250);
      }
    });

    ws.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function main() {
  require(path.join(ROOT, 'node_modules', 'dotenv')).config({
    path: path.join(ROOT, '.env'),
  });

  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: '3011',
      NODE_ENV: 'development',
      ACCESS_GATE_PHRASE: PHRASE,
      ACCESS_GATE_SECRET: SECRET,
      ACCESS_GATE_TTL_DAYS: '30',
      ACCESS_GATE_COOKIE_NAME: 'telos_gate',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (d) => process.stdout.write(`[gate-ws-server] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[gate-ws-server:err] ${d}`));

  let email = null;

  try {
    await waitHealthy(child);
    console.log('server_up_on_3011');

    // 1) No Cookie header at all -> must be rejected with 4403, and quickly
    //    (not a silent accept, not a hang).
    const noCookie = await tryConnect({});
    assert(noCookie.closed === true, `expected socket to be closed with no cookie, got: ${JSON.stringify(noCookie)}`);
    assert(noCookie.code === 4403, `expected close code 4403 with no cookie, got ${noCookie.code}`);
    console.log('WS_NO_COOKIE_REJECTED_4403');

    // 2) Cookie header present but garbage/tampered value -> same rejection,
    //    not a crash, not silently treated as valid.
    const tampered = await tryConnect({ Cookie: 'telos_gate=not.a.real.jwt.token' });
    assert(tampered.closed === true, `expected socket to be closed with tampered cookie, got: ${JSON.stringify(tampered)}`);
    assert(tampered.code === 4403, `expected close code 4403 with tampered cookie, got ${tampered.code}`);
    console.log('WS_TAMPERED_COOKIE_REJECTED_4403');

    // 2b) A cookie signed with the WRONG secret (e.g. forged) must also be
    //     rejected — proves verification actually checks the signature,
    //     not just presence of a token-shaped string.
    const jwt = require(path.join(ROOT, 'node_modules', 'jsonwebtoken'));
    const forged = jwt.sign({ purpose: 'access_gate' }, 'not-the-real-secret', { expiresIn: '30d' });
    const forgedResult = await tryConnect({ Cookie: `telos_gate=${forged}` });
    assert(forgedResult.closed === true, `expected socket closed for forged-secret cookie, got: ${JSON.stringify(forgedResult)}`);
    assert(forgedResult.code === 4403, `expected 4403 for forged-secret cookie, got ${forgedResult.code}`);
    console.log('WS_FORGED_SECRET_COOKIE_REJECTED_4403');

    // 3) Control case: valid gate cookie + valid session token -> must NOT
    //    be closed, must reach connection.ready. Proves the check isn't
    //    accidentally blocking everyone.
    const verify = await req('POST', '/access-gate/verify', { body: { attempt: PHRASE } });
    assert(verify.status === 204, `verify should 204, got ${verify.status} ${JSON.stringify(verify.json)}`);
    const gateCookie = extractGateCookie(verify.setCookie);
    assert(gateCookie, 'expected telos_gate Set-Cookie from verify');

    const stamp = Date.now();
    email = `gatews85_${stamp}@telos.test`;
    const password = 'Password123!';
    const signup = await req('POST', '/auth/signup', { cookie: gateCookie, body: { email, password } });
    assert(signup.status === 201, `signup failed: ${JSON.stringify(signup.json)}`);
    const login = await req('POST', '/auth/login', { cookie: gateCookie, body: { email, password } });
    assert(login.status === 200 && login.json.token, `login failed: ${JSON.stringify(login.json)}`);
    const sessionToken = login.json.token;

    const cookieHeader = gateCookie.split(';')[0];
    const good = await tryConnect(
      { Cookie: cookieHeader },
      { path: `/ws?token=${encodeURIComponent(sessionToken)}` }
    );
    assert(good.closed === false, `expected connection to stay open with valid cookie+token, got: ${JSON.stringify(good)}`);
    const readyMsg = good.messages.find((m) => m && m.event === 'connection.ready');
    assert(readyMsg, `expected connection.ready, got: ${JSON.stringify(good)}`);
    console.log('WS_VALID_COOKIE_ACCEPTED_CONFIRMED');

    console.log('ACCESS_GATE_WS_85_PASS');
  } finally {
    if (email) {
      try {
        const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
        const client = new Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        await client.query(`DELETE FROM users WHERE email = $1`, [email]);
        await client.end();
      } catch {
        /* best-effort cleanup */
      }
    }
    child.kill('SIGTERM');
    await sleep(500);
    if (child.exitCode == null) child.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error('FAIL', err.message);
  console.error(err.stack);
  process.exit(1);
});
