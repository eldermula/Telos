/**
 * Smoke: 5.7 WebSocket client contract. Uses Node's native WebSocket
 * (stable since Node 22) — mirrors what src/lib/ws.ts does in the browser.
 * Verifies: auth via ?token= query param, `connection.ready` with a null
 * bot_instance_id pre-broker-link (server allows this per
 * backend/src/ws/websocket-server.js), and a clean 4401 close on a bad token.
 */
const API = process.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';
const WS_BASE = process.env.VITE_WS_BASE_URL || 'ws://localhost:3000';
const email = `ws57_${Date.now()}@telos.test`;
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

function waitForMessage(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), timeoutMs);
    socket.addEventListener(
      'message',
      (event) => {
        clearTimeout(timer);
        resolve(JSON.parse(event.data));
      },
      { once: true },
    );
  });
}

function waitForClose(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for close')), timeoutMs);
    socket.addEventListener(
      'close',
      (event) => {
        clearTimeout(timer);
        resolve(event.code);
      },
      { once: true },
    );
  });
}

async function main() {
  const signup = await req('/auth/signup', { method: 'POST', body: { email, password } });
  assert(signup.status === 201, `signup expected 201, got ${signup.status}`);

  const login = await req('/auth/login', { method: 'POST', body: { email, password } });
  const token = login.data.token;

  // 1. Valid token, no broker linked yet -> connection.ready with bot_instance_id: null
  const socket = new WebSocket(`${WS_BASE}/ws?token=${encodeURIComponent(token)}`);
  const ready = await waitForMessage(socket, 5000);
  assert(ready.event === 'connection.ready', `expected connection.ready, got ${ready.event}`);
  assert(
    ready.payload?.bot_instance_id === null,
    `expected null bot_instance_id pre-broker-link, got ${JSON.stringify(ready.payload)}`,
  );
  socket.close();

  // 2. Invalid token -> 4401 close, matching src/lib/ws.ts's stop-retrying path
  const badSocket = new WebSocket(`${WS_BASE}/ws?token=not-a-real-token`);
  const closeCode = await waitForClose(badSocket, 5000);
  assert(closeCode === 4401, `expected close code 4401 for bad token, got ${closeCode}`);

  console.log('WEBSOCKET_UI_57_PASS');
}

main().catch((err) => {
  console.error('WEBSOCKET_UI_57_FAIL', err.message);
  process.exit(1);
});
