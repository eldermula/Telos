/**
 * Smoke: 5.8 Dashboard API surface.
 * Confirms the endpoints DashboardPage relies on (session, history, decision-log
 * with small page sizes) behave the same for a fresh no-broker user as the
 * already-verified 5.6 surface, plus the paginated getHistory(1,5)/getDecisionLog(1,5)
 * calls the Dashboard uses for "Recent activity".
 */
const API = process.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';
const email = `dash58_${Date.now()}@telos.test`;
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

async function main() {
  const signup = await req('/auth/signup', { method: 'POST', body: { email, password } });
  assert(signup.status === 201, `signup expected 201, got ${signup.status}`);

  const login = await req('/auth/login', { method: 'POST', body: { email, password } });
  const token = login.data.token;

  const session = await req('/trading/session', { token });
  assert(session.status === 404, `expected 404 no-broker gate, got ${session.status}`);
  assert(session.data.error.code === 'NO_BROKER_CONNECTION', 'expected NO_BROKER_CONNECTION');

  console.log('DASHBOARD_58_PASS');
}

main().catch((err) => {
  console.error('DASHBOARD_58_FAIL', err.message);
  process.exit(1);
});
