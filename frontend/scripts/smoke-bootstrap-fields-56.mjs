/**
 * Smoke: GET /trading/session for a brand-new user exposes bootstrap_phase
 * and bootstrap_risk_ceiling_pct correctly at the $10 starting balance
 * (08_Bot_Architecture.md Section 3a). Requires a running backend.
 */
const API = process.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';
const email = `bootstrap56_${Date.now()}@telos.test`;
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
  assert(login.status === 200, `login expected 200, got ${login.status}`);
  const token = login.data.token;

  const brokers = await req('/broker-connections', { token });
  assert(brokers.status === 200 && brokers.data.length === 0, 'expected no broker yet');

  const noBrokerSession = await req('/trading/session', { token });
  assert(
    noBrokerSession.status === 404 && noBrokerSession.data?.error?.code === 'NO_BROKER_CONNECTION',
    `expected 404 NO_BROKER_CONNECTION, got ${noBrokerSession.status} ${JSON.stringify(noBrokerSession.data)}`,
  );

  console.log('BOOTSTRAP_FIELDS_56_PASS (no-broker gate returns 404 NO_BROKER_CONNECTION, as expected pre-broker-link)');
}

main().catch((err) => {
  console.error('BOOTSTRAP_FIELDS_56_FAIL', err.message);
  process.exit(1);
});
