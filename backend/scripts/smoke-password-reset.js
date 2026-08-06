const path = require('path');
const backend = path.join(__dirname, '..', 'node_modules');
require(path.join(backend, 'dotenv')).config({ path: path.join(__dirname, '..', '.env') });
const Redis = require(path.join(backend, 'ioredis'));

async function main() {
  const email = `reset_${Date.now()}@telos.test`;
  const password = 'Password123!';
  const base = 'http://localhost:3000/api/v1/auth';

  const signupRes = await fetch(`${base}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const signupBody = await signupRes.json();
  console.log('signup', signupRes.status);
  const userId = signupBody.user.id;

  const reqRes = await fetch(`${base}/password-reset/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  console.log('reset_request', reqRes.status, await reqRes.json());

  const redis = new Redis(process.env.REDIS_URL);
  const keys = await redis.keys('password_reset:*');
  let token = null;
  for (const key of keys) {
    const value = await redis.get(key);
    if (value === userId) {
      token = key.slice('password_reset:'.length);
      break;
    }
  }
  if (!token) {
    console.error('FAIL: no password_reset key for user');
    process.exit(1);
  }

  const confirmRes = await fetch(`${base}/password-reset/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: 'NewPassword123!' }),
  });
  console.log('reset_confirm', confirmRes.status, await confirmRes.json());

  const loginOld = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  console.log('login_old_password', loginOld.status);

  const loginNew = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'NewPassword123!' }),
  });
  console.log('login_new_password', loginNew.status);

  await redis.quit();
  if (confirmRes.status !== 200 || loginOld.status !== 401 || loginNew.status !== 200) {
    process.exit(1);
  }
  console.log('password_reset_flow PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
