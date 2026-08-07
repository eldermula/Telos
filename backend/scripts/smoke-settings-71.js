/**
 * Phase 7.1 — Settings API smoke (06 §12 / FR-SET-1, FR-SET-3).
 * Exercises profile GET/PATCH (email + password) and notification
 * preferences GET/PATCH against the live backend.
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
  const email = `settings71_${Date.now()}@telos.test`;
  const password = 'Password123!';
  const newEmail = `settings71b_${Date.now()}@telos.test`;
  const newPassword = 'Password456!';

  let r = await req('POST', '/auth/signup', { body: { email, password } });
  assert(r.status === 201, `signup failed: ${JSON.stringify(r.json)}`);

  r = await req('POST', '/auth/login', { body: { email, password } });
  assert(r.status === 200 && r.json.token, 'login failed');
  let token = r.json.token;

  r = await req('GET', '/settings/profile', { token });
  console.log('profile_get', r.status, r.json && { email: r.json.email, role: r.json.role });
  assert(r.status === 200, `profile get failed: ${JSON.stringify(r.json)}`);
  assert(r.json.email === email, 'profile email mismatch');
  assert(r.json.role === 'user', 'expected role=user');

  r = await req('GET', '/settings/notifications', { token });
  console.log('prefs_get', r.status, r.json && r.json.preferences);
  assert(r.status === 200, `prefs get failed: ${JSON.stringify(r.json)}`);
  assert(r.json.preferences.bot_start === true, 'default bot_start should be true');
  assert(r.json.preferences.strategy_switch === true, 'default strategy_switch should be true');

  r = await req('PATCH', '/settings/notifications', {
    token,
    body: { preferences: { bot_start: false, strategy_switch: false } },
  });
  console.log('prefs_patch', r.status, r.json && r.json.preferences);
  assert(r.status === 200, `prefs patch failed: ${JSON.stringify(r.json)}`);
  assert(r.json.preferences.bot_start === false, 'bot_start should be false after patch');
  assert(r.json.preferences.bot_stop === true, 'untouched keys should keep defaults');
  assert(r.json.preferences.strategy_switch === false, 'strategy_switch should be false');

  r = await req('GET', '/settings/notifications', { token });
  assert(r.json.preferences.bot_start === false, 'prefs did not persist');

  r = await req('PATCH', '/settings/profile', {
    token,
    body: { email: newEmail, current_password: password, new_password: newPassword },
  });
  console.log('profile_patch', r.status, r.json && { email: r.json.email });
  assert(r.status === 200, `profile patch failed: ${JSON.stringify(r.json)}`);
  assert(r.json.email === newEmail, 'email was not updated');

  // Old credentials must fail; new credentials must work.
  r = await req('POST', '/auth/login', { body: { email, password } });
  assert(r.status === 401, 'old credentials should fail after email+password change');

  r = await req('POST', '/auth/login', { body: { email: newEmail, password: newPassword } });
  assert(r.status === 200 && r.json.token, 'login with new credentials failed');
  token = r.json.token;

  r = await req('GET', '/settings/profile', { token });
  assert(r.status === 200 && r.json.email === newEmail, 'profile after re-login mismatch');

  // Wrong current password must be rejected.
  r = await req('PATCH', '/settings/profile', {
    token,
    body: { current_password: 'wrong-password', new_password: 'Password789!' },
  });
  assert(r.status === 401, `expected 401 on bad current_password, got ${r.status}`);

  console.log('SETTINGS_71_PASS');
}

main().catch((err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
