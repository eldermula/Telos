'use strict';

/**
 * Proves admin.service enable/disable for synthetic + forex demo toggles
 * each call writeAudit with the expected action string (12 actions).
 *
 * Stubs pool.query (captures admin_audit_log inserts) and both demo
 * dispatch services so no Postgres/Redis is required.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const BACKEND_SRC = path.join(__dirname, '..');
const ADMIN_SERVICE_JS = path.join(BACKEND_SRC, 'services', 'admin.service.js');

const EXPECTED_ACTIONS = [
  'synthetic_demo_dispatch.enable',
  'synthetic_demo_dispatch.disable',
  'synthetic_demo_confirm.enable',
  'synthetic_demo_confirm.disable',
  'synthetic_demo_manual_trade.enable',
  'synthetic_demo_manual_trade.disable',
  'forex_demo_dispatch.enable',
  'forex_demo_dispatch.disable',
  'forex_demo_confirm.enable',
  'forex_demo_confirm.disable',
  'forex_demo_manual_trade.enable',
  'forex_demo_manual_trade.disable',
];

function childScript() {
  return `
    const Module = require('module');
    const path = require('path');
    const assert = require('node:assert/strict');
    const backendSrc = ${JSON.stringify(BACKEND_SRC)};
    const adminServicePath = ${JSON.stringify(ADMIN_SERVICE_JS)};

    const enabledStatus = {
      enabled: true,
      enabled_until: '2099-01-01T00:00:00.000Z',
      remaining_seconds: 999,
    };
    const disabledStatus = {
      enabled: false,
      enabled_until: null,
      remaining_seconds: 0,
    };

    const auditRows = [];
    const demoApi = {
      getDispatchStatus: async () => enabledStatus,
      getConfirmStatus: async () => enabledStatus,
      getManualTestTradeStatus: async () => enabledStatus,
      enableDispatch: async () => enabledStatus,
      disableDispatch: async () => disabledStatus,
      enableConfirm: async () => enabledStatus,
      disableConfirm: async () => disabledStatus,
      enableManualTestTrade: async () => enabledStatus,
      disableManualTestTrade: async () => disabledStatus,
    };

    const stubs = new Map([
      [path.join(backendSrc, 'db', 'pool.js'), {
        pool: {
          query: async (sql, params) => {
            if (String(sql).includes('admin_audit_log')) {
              auditRows.push({ sql: String(sql), params });
            }
            return { rows: [] };
          },
        },
      }],
      [path.join(backendSrc, 'db', 'redis.js'), {
        redis: {
          status: 'wait',
          get: async () => null,
          set: async () => 'OK',
          del: async () => 0,
          connect: async () => {},
          on: () => {},
          quit: async () => {},
        },
        connectRedis: async () => {},
      }],
      [path.join(backendSrc, 'engine', 'synthetic-demo-dispatch.service.js'), { ...demoApi }],
      [path.join(backendSrc, 'engine', 'forex-demo-dispatch.service.js'), { ...demoApi }],
      [path.join(backendSrc, 'engine', 'risk-tier-config.service.js'), {
        invalidateCache: async () => {},
        getConfig: async () => ({}),
      }],
      [path.join(backendSrc, 'services', 'news-llm-usage.js'), {
        getNewsLlmUsage: async () => ({ enabled: false }),
      }],
      [path.join(backendSrc, 'config', 'env.js'), {
        NEWS_LLM_ENABLED: false,
        RISK_TIER_CONFIG_CACHE_TTL_SECONDS: 20,
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

    const admin = require(adminServicePath);
    const adminUserId = '00000000-0000-4000-8000-0000000000aa';
    const minutes = 5;

    (async () => {
      await admin.enableSyntheticDemoDispatch(adminUserId, minutes);
      await admin.disableSyntheticDemoDispatch(adminUserId);
      await admin.enableSyntheticDemoConfirm(adminUserId, minutes);
      await admin.disableSyntheticDemoConfirm(adminUserId);
      await admin.enableSyntheticDemoManualTrade(adminUserId, minutes);
      await admin.disableSyntheticDemoManualTrade(adminUserId);
      await admin.enableForexDemoDispatch(adminUserId, minutes);
      await admin.disableForexDemoDispatch(adminUserId);
      await admin.enableForexDemoConfirm(adminUserId, minutes);
      await admin.disableForexDemoConfirm(adminUserId);
      await admin.enableForexDemoManualTrade(adminUserId, minutes);
      await admin.disableForexDemoManualTrade(adminUserId);

      const expected = ${JSON.stringify(EXPECTED_ACTIONS)};
      assert.equal(auditRows.length, expected.length, 'expected 12 audit inserts');

      for (let i = 0; i < expected.length; i++) {
        const actionText = auditRows[i].params[1];
        assert.equal(auditRows[i].params[0], adminUserId);
        assert.ok(
          String(actionText).startsWith(expected[i]),
          'row ' + i + ' action prefix: got ' + actionText + ' want ' + expected[i]
        );
        if (expected[i].endsWith('.enable')) {
          assert.match(String(actionText), /"minutes":5/);
          assert.match(String(actionText), /"enabled_until":"2099-01-01T00:00:00.000Z"/);
        } else {
          assert.equal(String(actionText), expected[i]);
        }
      }

      console.log('AUDIT_ACTIONS_OK');
      process.exit(0);
    })().catch((err) => {
      console.error('AUDIT_TEST_FAILED', err && err.stack ? err.stack : err);
      process.exit(1);
    });
  `;
}

test('admin.service demo toggles writeAudit for all 12 synthetic+forex actions', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'telos-demo-audit-'));
  const result = spawnSync(process.execPath, ['-e', childScript()], {
    cwd,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/db',
      REDIS_URL: 'redis://127.0.0.1:1',
      JWT_SECRET: 'child-test-secret',
    },
    encoding: 'utf8',
    timeout: 20000,
  });

  assert.equal(
    result.status,
    0,
    `status=${result.status} stdout=${result.stdout} stderr=${result.stderr} signal=${result.signal}`
  );
  assert.match(result.stdout, /AUDIT_ACTIONS_OK/);
});
