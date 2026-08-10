'use strict';

/**
 * Guards for POST /trading/test-dispatch-real (no live orders).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const BACKEND_SRC = path.join(__dirname, '..');
const TRADING_ENGINE_JS = path.join(__dirname, 'trading-engine.js');
const USER_ID = '00000000-0000-4000-8000-000000000001';

function runChild(body) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'telos-fx-dispatch-'));
  return spawnSync(process.execPath, ['-e', body], {
    cwd,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_ENV: 'test',
      REAL_TRADING_ENABLED: 'true',
      DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/db',
      REDIS_URL: 'redis://127.0.0.1:1',
      JWT_SECRET: 'child-test-secret',
    },
    encoding: 'utf8',
    timeout: 20000,
  });
}

function childScript({ manualEnabled, expectCode }) {
  return `
    const Module = require('module');
    const path = require('path');
    const backendSrc = ${JSON.stringify(BACKEND_SRC)};
    const tradingEnginePath = ${JSON.stringify(TRADING_ENGINE_JS)};
    const manualEnabled = ${JSON.stringify(manualEnabled)};
    const expectCode = ${JSON.stringify(expectCode)};
    const userId = ${JSON.stringify(USER_ID)};

    const stubs = new Map([
      [path.join(backendSrc, 'db', 'pool.js'), { pool: { query: async () => ({ rows: [] }) } }],
      [path.join(backendSrc, 'db', 'redis.js'), {
        redis: {
          status: 'wait',
          connect: async () => {},
          on: () => {},
          quit: async () => {},
          get: async () => null,
          set: async () => 'OK',
          del: async () => 0,
        },
        connectRedis: async () => {},
      }],
      [path.join(backendSrc, 'engine', 'bot-runtime.js'), {
        startRuntime: async () => ({}),
        stopRuntime: async () => {},
        getRuntime: () => null,
        BotRuntime: class {},
      }],
      [path.join(backendSrc, 'engine', 'bot-status.cache.js'), {
        setStatus: async (x) => x,
        getStatus: async () => null,
      }],
      [path.join(backendSrc, 'engine', 'bot-instance.repository.js'), {
        ensureForUser: async () => ({
          id: '11111111-1111-4111-8111-111111111111',
          user_id: userId,
          status: 'running',
          account_type: 'demo',
          live_trading_confirmed_at: new Date().toISOString(),
        }),
      }],
      [path.join(backendSrc, 'engine', 'event-publisher.js'), {
        publishBotEvent: async () => {},
      }],
      [path.join(backendSrc, 'services', 'notifications.service.js'), {
        maybeNotifyUser: async () => null,
        forceNotifyUser: async () => null,
      }],
      [path.join(backendSrc, 'engine', 'forex-demo-dispatch.service.js'), {
        isDemoConfirmEnabled: async () => true,
        isDemoDispatchEnabled: async () => true,
        isManualTestTradeEnabled: async () => manualEnabled,
      }],
      [path.join(backendSrc, 'engine', 'trades.repository.js'), {
        listOpenTradesForUser: async () => [],
        findTradeByIdForUser: async () => null,
      }],
    ]);

    const orig = Module.prototype.require;
    Module.prototype.require = function (id) {
      if (stubs.has(id)) return stubs.get(id);
      try {
        const resolved = Module._resolveFilename(id, this);
        if (stubs.has(resolved)) return stubs.get(resolved);
      } catch (_) { /* fall through */ }
      return orig.apply(this, arguments);
    };

    const te = require(tradingEnginePath);
    te.testDispatchForexReal(userId, { symbol: 'EURUSD', direction: 'BUY' })
      .then(() => {
        console.log('UNEXPECTED_OK');
        process.exit(2);
      })
      .catch((err) => {
        if (err && err.code === expectCode) {
          console.log('REFUSED', err.code);
          process.exit(0);
        }
        console.error('WRONG_ERROR', err && err.code, err && err.message);
        process.exit(3);
      });
  `;
}

test('testDispatchForexReal refuses when manual test-trade toggle is off', () => {
  const result = runChild(
    childScript({ manualEnabled: false, expectCode: 'MANUAL_TEST_TRADE_DISABLED' })
  );
  assert.equal(
    result.status,
    0,
    `status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`
  );
  assert.match(result.stdout, /REFUSED MANUAL_TEST_TRADE_DISABLED/);
});

test('testDispatchForexReal refuses when runtime not loaded (toggle on)', () => {
  const result = runChild(
    childScript({ manualEnabled: true, expectCode: 'RUNTIME_NOT_LOADED' })
  );
  assert.equal(
    result.status,
    0,
    `status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`
  );
  assert.match(result.stdout, /REFUSED RUNTIME_NOT_LOADED/);
});
