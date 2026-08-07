/**
 * Phase 7.7 — AI Assistant smoke (read-only stub; no trading side effects).
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
  try {
    const { redis, connectRedis } = require('../src/db/redis');
    await connectRedis();
    await redis.del('ratelimit:::ffff:127.0.0.1:/auth/login');
  } catch {
    /* ignore */
  }

  const email = `assistant77_${Date.now()}@telos.test`;
  const password = 'Password123!';
  let r = await req('POST', '/auth/signup', { body: { email, password } });
  assert(r.status === 201, `signup failed: ${JSON.stringify(r.json)}`);
  r = await req('POST', '/auth/login', { body: { email, password } });
  assert(r.status === 200 && r.json.token, `login failed: ${JSON.stringify(r.json)}`);
  const token = r.json.token;

  r = await req('GET', '/assistant/insights', { token });
  assert(r.status === 200 && Array.isArray(r.json.insights), `insights: ${JSON.stringify(r.json)}`);
  assert(r.json.source === 'rule_based_stub', 'insights source');

  r = await req('POST', '/assistant/conversations', { token });
  assert(r.status === 201 && r.json.id, `create conversation: ${JSON.stringify(r.json)}`);
  const conversationId = r.json.id;

  r = await req('GET', '/assistant/conversations', { token });
  assert(r.status === 200 && r.json.data.some((c) => c.id === conversationId), 'list conversations');

  r = await req('POST', `/assistant/conversations/${conversationId}/messages`, {
    token,
    body: { content: 'What is my drawdown and risk posture?' },
  });
  assert(r.status === 201, `post message: ${JSON.stringify(r.json)}`);
  assert(r.json.user_message?.role === 'user', 'user message');
  assert(r.json.assistant_message?.role === 'assistant', 'assistant message');
  assert(
    String(r.json.assistant_message.content).includes('read-only') ||
      String(r.json.assistant_message.content).includes('can’t start') ||
      String(r.json.assistant_message.content).includes("can't start"),
    'must stay advisory'
  );
  assert(
    /stub reply/i.test(r.json.assistant_message.content),
    'stub marker expected while LLM unset'
  );

  r = await req('GET', `/assistant/conversations/${conversationId}/messages`, { token });
  assert(r.status === 200 && r.json.data.length >= 2, 'message history');

  // Ownership: second user must not see this conversation
  const email2 = `assistant77b_${Date.now()}@telos.test`;
  r = await req('POST', '/auth/signup', { body: { email: email2, password } });
  assert(r.status === 201, 'signup2');
  r = await req('POST', '/auth/login', { body: { email: email2, password } });
  const token2 = r.json.token;
  r = await req('GET', `/assistant/conversations/${conversationId}/messages`, { token: token2 });
  assert(r.status === 404, 'cross-user conversation must 404');

  console.log('ASSISTANT_77_PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
