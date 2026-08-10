'use strict';

/**
 * REAL_TRADING_ALLOW_DEMO was retired in favor of admin DB toggles
 * (forex_demo_dispatch_config). These tests prove the env export and
 * production boot tripwire are gone — leftover env must not refuse boot.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('path');

const ENV_JS = path.join(__dirname, 'env.js');

function loadEnvInChild(envOverrides, evalExpr) {
  return spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(ENV_JS)}); ${evalExpr}`],
    {
      cwd: os.tmpdir(),
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ...envOverrides,
      },
      encoding: 'utf8',
    }
  );
}

test('REAL_TRADING_ALLOW_DEMO is no longer exported from env.js', () => {
  const result = loadEnvInChild(
    { NODE_ENV: 'development' },
    `const e = require(${JSON.stringify(ENV_JS)}); process.stdout.write(String('REAL_TRADING_ALLOW_DEMO' in e));`
  );
  assert.equal(result.status, 0, result.stderr);
  const lastLine = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  assert.equal(lastLine, 'false');
});

test('assertRealTradingDemoBypassAtStartup is no longer exported', () => {
  const result = loadEnvInChild(
    { NODE_ENV: 'production', REAL_TRADING_ALLOW_DEMO: 'true' },
    `const e = require(${JSON.stringify(ENV_JS)}); process.stdout.write(String(typeof e.assertRealTradingDemoBypassAtStartup));`
  );
  assert.equal(result.status, 0, result.stderr);
  const lastLine = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  assert.equal(lastLine, 'undefined');
});

test('production + leftover REAL_TRADING_ALLOW_DEMO=true does not refuse env load', () => {
  const result = loadEnvInChild(
    { NODE_ENV: 'production', REAL_TRADING_ALLOW_DEMO: 'true' },
    `require(${JSON.stringify(ENV_JS)}); console.log('BOOTED');`
  );
  assert.equal(result.status, 0, `stderr=${result.stderr}`);
  assert.match(result.stdout, /BOOTED/);
});

test('REAL_TRADING_ENABLED remains exact-string true only', () => {
  const cases = [
    ['true', 'true'],
    ['True', 'false'],
    ['1', 'false'],
    ['', 'false'],
  ];
  for (const [raw, expected] of cases) {
    const result = loadEnvInChild(
      { NODE_ENV: 'development', REAL_TRADING_ENABLED: raw },
      `const e = require(${JSON.stringify(ENV_JS)}); process.stdout.write(String(e.REAL_TRADING_ENABLED));`
    );
    assert.equal(result.status, 0, result.stderr);
    const lastLine = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    assert.equal(lastLine, expected, `raw=${JSON.stringify(raw)}`);
  }
});
