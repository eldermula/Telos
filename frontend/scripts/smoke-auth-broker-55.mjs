/**
 * Smoke: Auth + broker API contract used by frontend Increment 5.3–5.5.
 * Does not require MT5 for list/empty broker check; optional link skipped.
 */
const API = process.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';
const email = `frontend55_${Date.now()}@telos.test`;
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
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const signup = await req('/auth/signup', {
    method: 'POST',
    body: { email, password },
  });
  assert(signup.status === 201, `signup expected 201, got ${signup.status}`);
  assert(signup.data?.user?.email === email, 'signup user email mismatch');

  const login = await req('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  assert(login.status === 200, `login expected 200, got ${login.status}`);
  assert(typeof login.data?.token === 'string', 'login missing token');

  const me = await req('/auth/me', { token: login.data.token });
  assert(me.status === 200, `me expected 200, got ${me.status}`);
  assert(me.data?.email === email, 'me email mismatch (flat user shape)');

  const brokers = await req('/broker-connections', { token: login.data.token });
  assert(brokers.status === 200, `brokers expected 200, got ${brokers.status}`);
  assert(Array.isArray(brokers.data), 'brokers should be an array');
  assert(brokers.data.length === 0, 'new user should have no broker yet');

  console.log('FRONTEND_53_55_PASS');
}

main().catch((err) => {
  console.error('FRONTEND_53_55_FAIL', err.message);
  process.exit(1);
});
