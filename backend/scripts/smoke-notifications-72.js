/**
 * Phase 7.2 — Notifications API smoke (06 §11 / FR-NOTIF-1–3).
 * Creates notifications via Start/Stop, exercises list + mark-read,
 * preference gating, and the /notifications/preferences alias.
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
  return { status: res.status, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const email = `notif72_${Date.now()}@telos.test`;
  const password = 'Password123!';

  let r = await req('POST', '/auth/signup', { body: { email, password } });
  assert(r.status === 201, `signup failed: ${JSON.stringify(r.json)}`);
  r = await req('POST', '/auth/login', { body: { email, password } });
  assert(r.status === 200 && r.json.token, 'login failed');
  const token = r.json.token;

  // Seed a connected broker so Start Trading can succeed (attach-mode).
  r = await req('POST', '/broker-connections', {
    token,
    body: {
      broker_name: 'mt5',
      credentials: {
        login: '5053904111',
        password: 'placeholder-not-the-real-mt5-password',
        server: 'MetaQuotes-Demo',
      },
    },
  });
  assert(r.status === 201, `broker link failed: ${JSON.stringify(r.json)}`);

  r = await req('POST', '/trading/session/start', { token });
  console.log('start', r.status, r.json && r.json.status);
  assert(r.status === 200 && r.json.status === 'running', `start failed: ${JSON.stringify(r.json)}`);

  r = await req('GET', '/notifications', { token });
  console.log('list_after_start', r.status, r.json && r.json.meta, r.json && r.json.data.map((n) => n.type));
  assert(r.status === 200, `list failed: ${JSON.stringify(r.json)}`);
  assert(r.json.meta.total >= 1, 'expected at least one notification after start');
  assert(r.json.data.some((n) => n.type === 'bot_start'), 'missing bot_start notification');
  const startNotif = r.json.data.find((n) => n.type === 'bot_start');
  assert(startNotif.read_status === false, 'new notification should be unread');

  r = await req('PATCH', `/notifications/${startNotif.id}`, {
    token,
    body: { read_status: true },
  });
  assert(r.status === 200 && r.json.read_status === true, `mark read failed: ${JSON.stringify(r.json)}`);

  r = await req('POST', '/trading/session/stop', { token });
  assert(r.status === 200 && r.json.status === 'stopped', `stop failed: ${JSON.stringify(r.json)}`);

  r = await req('GET', '/notifications', { token });
  assert(r.json.data.some((n) => n.type === 'bot_stop'), 'missing bot_stop notification');

  // Preference gating: disable bot_start, start again — should not create another bot_start.
  r = await req('PATCH', '/notifications/preferences', {
    token,
    body: { preferences: { bot_start: false } },
  });
  assert(r.status === 200 && r.json.preferences.bot_start === false, 'prefs alias patch failed');

  const before = (await req('GET', '/notifications', { token })).json.meta.total;
  r = await req('POST', '/trading/session/start', { token });
  assert(r.status === 200, 'second start failed');
  const after = (await req('GET', '/notifications', { token })).json;
  const startCount = after.data.filter((n) => n.type === 'bot_start').length;
  assert(startCount === 1, `expected still exactly 1 bot_start after prefs disable, got ${startCount}`);
  assert(after.meta.total === before, 'notification count should not grow when bot_start prefs are off');

  r = await req('POST', '/trading/session/stop', { token });
  assert(r.status === 200, 'final stop failed');

  console.log('NOTIFICATIONS_72_PASS');
}

main().catch((err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
