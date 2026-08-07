/**
 * Phase 8.4 — trivial liveness smoke for the endpoint external uptime
 * monitors should hit (docs/OPS.md §2).
 *
 * Requires: API server on 127.0.0.1:3000 (or HEALTH_URL override).
 * Does not need auth, Postgres, Redis, or MT5 — /health is deliberately
 * a process-liveness probe, not a dependency check.
 */
const BASE = process.env.HEALTH_URL || 'http://127.0.0.1:3000/health';

async function main() {
  const res = await fetch(BASE);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`expected JSON from ${BASE}, got: ${text.slice(0, 200)}`);
  }
  if (res.status !== 200) {
    throw new Error(`expected HTTP 200, got ${res.status}`);
  }
  if (!json || json.status !== 'ok') {
    throw new Error(`expected { status: 'ok' }, got ${JSON.stringify(json)}`);
  }
  console.log('HEALTH_84_PASS', { url: BASE, body: json });
}

main().catch((err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
