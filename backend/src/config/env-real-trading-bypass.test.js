'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('path');

const { assertRealTradingDemoBypassAllowed } = require('./env');

const ENV_JS = path.join(__dirname, 'env.js');

/**
 * Load env.js in a clean child process with an explicit env block so
 * this process's dotenv/.env can't leak REAL_TRADING_ALLOW_DEMO into
 * the case under test. Returns { status, stdout, stderr }.
 */
function loadEnvInChild(envOverrides, evalExpr) {
  const result = spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(ENV_JS)}); ${evalExpr}`],
    {
      env: {
        // Minimal env — no dotenv file load of the parent's .env unless
        // dotenv finds one; point cwd away isn't reliable, so strip the
        // vars we care about and set PATH so node can still run.
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ...envOverrides,
      },
      encoding: 'utf8',
    }
  );
  return result;
}

test('production + bypass env present (literal true) → refuses', () => {
  assert.throws(
    () =>
      assertRealTradingDemoBypassAllowed({
        nodeEnv: 'production',
        allowDemoEnvPresent: true,
      }),
    /REAL_TRADING_ALLOW_DEMO must not be set when NODE_ENV=production/
  );
});

test('production + bypass env absent → allows boot', () => {
  assert.doesNotThrow(() =>
    assertRealTradingDemoBypassAllowed({
      nodeEnv: 'production',
      allowDemoEnvPresent: false,
    })
  );
});

test('development + bypass env present → allows boot (E1 is for non-production)', () => {
  assert.doesNotThrow(() =>
    assertRealTradingDemoBypassAllowed({
      nodeEnv: 'development',
      allowDemoEnvPresent: true,
    })
  );
});

test('development + bypass env absent → allows boot', () => {
  assert.doesNotThrow(() =>
    assertRealTradingDemoBypassAllowed({
      nodeEnv: 'development',
      allowDemoEnvPresent: false,
    })
  );
});

test('test NODE_ENV + bypass present → allows boot (non-production)', () => {
  assert.doesNotThrow(() =>
    assertRealTradingDemoBypassAllowed({
      nodeEnv: 'test',
      allowDemoEnvPresent: true,
    })
  );
});

test('assertRealTradingDemoBypassAtStartup: production + REAL_TRADING_ALLOW_DEMO=true → exit non-zero', () => {
  const result = loadEnvInChild(
    { NODE_ENV: 'production', REAL_TRADING_ALLOW_DEMO: 'true' },
    `require(${JSON.stringify(ENV_JS)}).assertRealTradingDemoBypassAtStartup(); console.log('BOOTED');`
  );
  assert.notEqual(result.status, 0, 'expected non-zero exit');
  assert.match(result.stderr, /REAL_TRADING_ALLOW_DEMO must not be set when NODE_ENV=production/);
  assert.equal(result.stdout.includes('BOOTED'), false);
});

test('assertRealTradingDemoBypassAtStartup: production + REAL_TRADING_ALLOW_DEMO=false (present) → still refuses', () => {
  // Presence tripwire, not truthiness — 'false' must also refuse.
  const result = loadEnvInChild(
    { NODE_ENV: 'production', REAL_TRADING_ALLOW_DEMO: 'false' },
    `require(${JSON.stringify(ENV_JS)}).assertRealTradingDemoBypassAtStartup(); console.log('BOOTED');`
  );
  assert.notEqual(result.status, 0, 'expected non-zero exit for any present value');
  assert.match(result.stderr, /REAL_TRADING_ALLOW_DEMO must not be set when NODE_ENV=production/);
});

test('assertRealTradingDemoBypassAtStartup: production + REAL_TRADING_ALLOW_DEMO empty string → still refuses', () => {
  const result = loadEnvInChild(
    { NODE_ENV: 'production', REAL_TRADING_ALLOW_DEMO: '' },
    `require(${JSON.stringify(ENV_JS)}).assertRealTradingDemoBypassAtStartup(); console.log('BOOTED');`
  );
  assert.notEqual(result.status, 0, 'expected non-zero exit for empty-string presence');
  assert.match(result.stderr, /REAL_TRADING_ALLOW_DEMO must not be set when NODE_ENV=production/);
});

test('assertRealTradingDemoBypassAtStartup: production + var unset → allows', () => {
  const result = loadEnvInChild(
    { NODE_ENV: 'production' },
    `require(${JSON.stringify(ENV_JS)}).assertRealTradingDemoBypassAtStartup(); console.log('BOOTED');`
  );
  assert.equal(result.status, 0, `expected clean boot, stderr=${result.stderr}`);
  assert.match(result.stdout, /BOOTED/);
});

test('assertRealTradingDemoBypassAtStartup: development + REAL_TRADING_ALLOW_DEMO=true → allows', () => {
  const result = loadEnvInChild(
    { NODE_ENV: 'development', REAL_TRADING_ALLOW_DEMO: 'true' },
    `require(${JSON.stringify(ENV_JS)}).assertRealTradingDemoBypassAtStartup(); console.log('BOOTED');`
  );
  assert.equal(result.status, 0, `expected clean boot, stderr=${result.stderr}`);
  assert.match(result.stdout, /BOOTED/);
});

test('REAL_TRADING_ALLOW_DEMO parsing: only exact "true" enables the boolean', () => {
  const cases = [
    ['true', 'true'],
    ['True', 'false'],
    ['1', 'false'],
    ['false', 'false'],
    ['', 'false'],
  ];
  for (const [raw, expected] of cases) {
    const env = { NODE_ENV: 'development' };
    if (raw !== undefined) env.REAL_TRADING_ALLOW_DEMO = raw;
    const result = loadEnvInChild(
      env,
      `const e = require(${JSON.stringify(ENV_JS)}); process.stdout.write(String(e.REAL_TRADING_ALLOW_DEMO));`
    );
    assert.equal(result.status, 0, `parse failed for ${JSON.stringify(raw)}: ${result.stderr}`);
    // dotenv may print a tip line to stdout — read the last non-empty line.
    const lastLine = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    assert.equal(lastLine, expected, `raw=${JSON.stringify(raw)}`);
  }

  // Unset → false
  const unset = loadEnvInChild(
    { NODE_ENV: 'development' },
    `const e = require(${JSON.stringify(ENV_JS)}); process.stdout.write(String(e.REAL_TRADING_ALLOW_DEMO));`
  );
  assert.equal(unset.status, 0, unset.stderr);
  const unsetLast = unset.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  assert.equal(unsetLast, 'false');
});
