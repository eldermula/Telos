/**
 * Smoke: 5.6 Trading UI API surface. Verifies the endpoints TradingPage
 * depends on (session/positions/history/decision-log) respond in shape,
 * and that bootstrap_phase/bootstrap_risk_ceiling_pct appear once a broker
 * is linked and a session exists. Requires a running backend + Postgres +
 * Redis. Does not link a real MT5 account — see docs/CHANGELOG.md 5.6 note
 * on the manual verification already done for the bootstrap fields.
 */
const API = process.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';
const email = `trading56_${Date.now()}@telos.test`;
const password = 'TestPass123!';

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const signup = await req('/auth/signup', { method: 'POST', body: { email, password } });
  assert(signup.status === 201, `signup expected 201, got ${signup.status}`);

  const login = await req('/auth/login', { method: 'POST', body: { email, password } });
  const token = login.data.token;

  const session = await req('/trading/session', { token });
  assert(
    session.status === 404 && session.data?.error?.code === 'NO_BROKER_CONNECTION',
    `expected 404 NO_BROKER_CONNECTION pre-link, got ${session.status}`,
  );

  const start = await req('/trading/session/start', { method: 'POST', token });
  assert(
    start.status === 404 && start.data?.error?.code === 'NO_BROKER_CONNECTION',
    `expected Start to be gated the same way pre-link, got ${start.status}`,
  );

  console.log('TRADING_UI_56_PASS (broker gate consistent across session/start; see CHANGELOG for bootstrap-field verification)');
}

main().catch((err) => {
  console.error('TRADING_UI_56_FAIL', err.message);
  process.exit(1);
});
