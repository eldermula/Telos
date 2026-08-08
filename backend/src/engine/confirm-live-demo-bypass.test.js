'use strict';

/**
 * Proves confirmLiveTrading itself refuses when NODE_ENV=production and
 * REAL_TRADING_ALLOW_DEMO is set — without going through index.js.
 *
 * Uses a child process with a stubbed require cache for heavy deps so
 * the test targets the function gate, not Postgres/Redis connectivity.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const BACKEND_SRC = path.join(__dirname, '..');
const TRADING_ENGINE_JS = path.join(__dirname, 'trading-engine.js');

function runChild(envOverrides, body) {
  // Run from a temp cwd so dotenv in env.js does not pick up backend/.env.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'telos-confirm-'));
  return spawnSync(process.execPath, ['-e', body], {
    cwd,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_ENV: 'production',
      REAL_TRADING_ALLOW_DEMO: 'true',
      DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/db',
      REDIS_URL: 'redis://127.0.0.1:1',
      JWT_SECRET: 'child-test-secret',
      ...envOverrides,
    },
    encoding: 'utf8',
    timeout: 20000,
  });
}

/**
 * Child script: stub the modules trading-engine pulls in for I/O, then
 * require the real trading-engine.js and call confirmLiveTrading.
 */
function childScript(expectCode) {
  return `
    const Module = require('module');
    const path = require('path');
    const backendSrc = ${JSON.stringify(BACKEND_SRC)};
    const tradingEnginePath = ${JSON.stringify(TRADING_ENGINE_JS)};

    const stubs = new Map([
      [path.join(backendSrc, 'db', 'pool.js'), { pool: { query: async () => ({ rows: [] }) } }],
      [path.join(backendSrc, 'db', 'redis.js'), {
        redis: { status: 'wait', connect: async () => {}, on: () => {}, quit: async () => {} },
        connectRedis: async () => {},
      }],
      [path.join(backendSrc, 'engine', 'bot-runtime.js'), {
        startRuntime: async () => ({}),
        stopRuntime: async () => {},
        getRuntime: () => null,
      }],
      [path.join(backendSrc, 'engine', 'bot-status.cache.js'), {
        setStatus: async (x) => x,
        getStatus: async () => null,
      }],
      [path.join(backendSrc, 'engine', 'bot-instance.repository.js'), {
        ensureForUser: async () => { throw new Error('ensureForUser must not run'); },
        findById: async () => null,
        updateStatusFields: async () => { throw new Error('update must not run'); },
      }],
      [path.join(backendSrc, 'engine', 'event-publisher.js'), {
        publishBotEvent: async () => {},
      }],
      [path.join(backendSrc, 'services', 'notifications.service.js'), {
        maybeNotifyUser: async () => null,
        forceNotifyUser: async () => null,
      }],
    ]);

    const orig = Module.prototype.require;
    Module.prototype.require = function (id) {
      if (stubs.has(id)) return stubs.get(id);
      // Resolve relative requires from trading-engine against real paths.
      try {
        const resolved = Module._resolveFilename(id, this);
        if (stubs.has(resolved)) return stubs.get(resolved);
      } catch (_) { /* fall through */ }
      return orig.apply(this, arguments);
    };

    const te = require(tradingEnginePath);
    te.confirmLiveTrading('00000000-0000-4000-8000-000000000001', 'I CONFIRM LIVE TRADING WITH REAL MONEY')
      .then(() => {
        console.log('UNEXPECTED_RESOLVE');
        process.exit(2);
      })
      .catch((err) => {
        if (err && err.code === ${JSON.stringify(expectCode)}) {
          console.log('REFUSED_BY_CONFIRM_LIVE');
          process.exit(0);
        }
        console.error('WRONG_ERROR', err && err.code, err && err.message);
        process.exit(3);
      });
  `;
}

test('confirmLiveTrading refuses under production + ALLOW_DEMO=true without index.js', () => {
  const result = runChild({ NODE_ENV: 'production', REAL_TRADING_ALLOW_DEMO: 'true' }, childScript('REAL_TRADING_DEMO_BYPASS_IN_PRODUCTION'));
  assert.equal(
    result.status,
    0,
    `status=${result.status} stdout=${result.stdout} stderr=${result.stderr} signal=${result.signal}`
  );
  assert.match(result.stdout, /REFUSED_BY_CONFIRM_LIVE/);
});

test('confirmLiveTrading refuses under production + ALLOW_DEMO present as false (presence alone)', () => {
  const result = runChild(
    { NODE_ENV: 'production', REAL_TRADING_ALLOW_DEMO: 'false' },
    childScript('REAL_TRADING_DEMO_BYPASS_IN_PRODUCTION')
  );
  assert.equal(
    result.status,
    0,
    `status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`
  );
  assert.match(result.stdout, /REFUSED_BY_CONFIRM_LIVE/);
});

test('development + ALLOW_DEMO=true does not hit production refuse (gate not fired)', () => {
  const result = runChild(
    { NODE_ENV: 'development', REAL_TRADING_ALLOW_DEMO: 'true' },
    `
    const Module = require('module');
    const path = require('path');
    const backendSrc = ${JSON.stringify(BACKEND_SRC)};
    const tradingEnginePath = ${JSON.stringify(TRADING_ENGINE_JS)};
    let ensureCalled = false;
    const stubs = new Map([
      [path.join(backendSrc, 'db', 'pool.js'), { pool: { query: async () => ({ rows: [] }) } }],
      [path.join(backendSrc, 'db', 'redis.js'), {
        redis: { status: 'wait', connect: async () => {}, on: () => {}, quit: async () => {} },
        connectRedis: async () => {},
      }],
      [path.join(backendSrc, 'engine', 'bot-runtime.js'), {
        startRuntime: async () => ({}),
        stopRuntime: async () => {},
        getRuntime: () => null,
      }],
      [path.join(backendSrc, 'engine', 'bot-status.cache.js'), {
        setStatus: async (x) => x,
        getStatus: async () => null,
      }],
      [path.join(backendSrc, 'engine', 'bot-instance.repository.js'), {
        ensureForUser: async () => {
          ensureCalled = true;
          return { id: 'b1', status: 'stopped', account_type: 'demo', user_id: 'u1' };
        },
        updateStatusFields: async (_id, fields) => ({
          id: 'b1', status: 'stopped', account_type: 'demo', ...fields,
        }),
      }],
      [path.join(backendSrc, 'engine', 'event-publisher.js'), { publishBotEvent: async () => {} }],
      [path.join(backendSrc, 'services', 'notifications.service.js'), {
        maybeNotifyUser: async () => null,
      }],
    ]);
    const orig = Module.prototype.require;
    Module.prototype.require = function (id) {
      try {
        const resolved = Module._resolveFilename(id, this);
        if (stubs.has(resolved)) return stubs.get(resolved);
      } catch (_) {}
      if (stubs.has(id)) return stubs.get(id);
      return orig.apply(this, arguments);
    };
    const te = require(tradingEnginePath);
    te.confirmLiveTrading('00000000-0000-4000-8000-000000000001', 'I CONFIRM LIVE TRADING WITH REAL MONEY')
      .then(() => {
        console.log(ensureCalled ? 'DEMO_CONFIRM_OK' : 'OK_BUT_ENSURE_SKIPPED');
        process.exit(0);
      })
      .catch((err) => {
        if (err && err.code === 'REAL_TRADING_DEMO_BYPASS_IN_PRODUCTION') {
          console.log('FALSE_PRODUCTION_REFUSE');
          process.exit(3);
        }
        console.error('OTHER_ERROR', err && err.code, err && err.message);
        process.exit(4);
      });
    `
  );
  assert.equal(
    result.status,
    0,
    `status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`
  );
  assert.match(result.stdout, /DEMO_CONFIRM_OK/);
});
