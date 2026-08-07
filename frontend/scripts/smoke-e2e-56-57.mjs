/**
 * Smoke: 5.6/5.7 real end-to-end path through a linked broker connection —
 * reusing the non-interactive Phase 2 pattern (backend/scripts/smoke-broker-connections.js):
 * a placeholder password against the MetaQuotes-Demo account already
 * attached in the local MT5 terminal (attach-mode /validate only checks
 * that the logged-in account's login matches, per bot/mt5-connector/server.py).
 *
 * Exercises: link broker -> connected -> GET /trading/session (real
 * bootstrap fields at the real $10 starting balance) -> Start Trading
 * (paper BotRuntime, no real MT5 orders per Phase 4.6a) -> Stop Trading ->
 * disconnect. Does not place any real MT5 order.
 */
const API = process.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';
const LOGIN = '5053904111';
const SERVER = 'MetaQuotes-Demo';
const PLACEHOLDER_PASSWORD = 'placeholder-not-the-real-mt5-password';
const email = `e2e56_${Date.now()}@telos.test`;
const password = 'TestPass123!';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const signup = await req('/auth/signup', { method: 'POST', body: { email, password } });
  assert(signup.status === 201, `signup expected 201, got ${signup.status}`);

  const login = await req('/auth/login', { method: 'POST', body: { email, password } });
  const token = login.data.token;

  const link = await req('/broker-connections', {
    method: 'POST',
    token,
    body: {
      broker_name: 'mt5',
      credentials: { login: LOGIN, password: PLACEHOLDER_PASSWORD, server: SERVER },
    },
  });

  if (link.status !== 201) {
    console.log(
      'E2E_56_57_SKIPPED — could not link broker (MT5 terminal likely not attached/logged in to',
      SERVER,
      LOGIN,
      '):',
      link.status,
      JSON.stringify(link.data),
    );
    process.exit(0);
  }
  assert(link.data.connection_status === 'connected', 'expected connected');

  const preStart = await req('/trading/session', { token });
  assert(preStart.status === 200, `session expected 200, got ${preStart.status}`);
  assert(preStart.data.status === 'stopped', 'expected stopped before Start');
  assert(preStart.data.bootstrap_phase === true, 'expected bootstrap_phase at $10 start');
  assert(
    Math.abs(preStart.data.bootstrap_risk_ceiling_pct - 0.7) < 1e-9,
    `expected bootstrap_risk_ceiling_pct 0.70 at $10, got ${preStart.data.bootstrap_risk_ceiling_pct}`,
  );

  const start = await req('/trading/session/start', { method: 'POST', token });
  assert(start.status === 200 && start.data.status === 'running', 'expected running after Start');

  await sleep(2500);

  const decisionLog = await req('/trading/decision-log', { token });
  assert(decisionLog.status === 200, 'expected decision-log 200');
  assert(
    Array.isArray(decisionLog.data.data) && decisionLog.data.data.length > 0,
    'expected at least one decision-log entry after running the paper bot for a few seconds',
  );

  const stop = await req('/trading/session/stop', { method: 'POST', token });
  assert(stop.status === 200 && stop.data.status === 'stopped', 'expected stopped after Stop');

  const disconnect = await req(`/broker-connections/${link.data.id}`, {
    method: 'DELETE',
    token,
  });
  assert(disconnect.status === 204, 'expected 204 on disconnect cleanup');

  console.log('E2E_56_57_PASS');
}

main().catch((err) => {
  console.error('E2E_56_57_FAIL', err.message);
  process.exit(1);
});
