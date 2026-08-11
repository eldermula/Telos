'use strict';

/**
 * M5 real-dispatch harness (UNPROVEN LIVE, docs/14_M5_Forex_Paper_Experiment.md)
 * — lifecycle + Layer 0-3 gating coverage against fully mocked deps. No
 * network, no DB, no MT5 connector calls anywhere in this file.
 *
 * Note on timing: start() fires its first tick fire-and-forget (mirrors
 * m5-paper-harness.js / bot-runtime.js — Start must not block on a full
 * tick). That means `await harness.start(...)` resolving does NOT imply
 * the first tick has finished. Tests that depend on tick-driven state use
 * waitUntil() below to poll for the expected outcome rather than assuming
 * a fixed number of microtask flushes.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createM5RealHarness } = require('./m5-real-harness');

async function waitUntil(predicate, { timeoutMs = 2000, intervalMs = 10 } = {}) {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error('waitUntil: condition not met within timeout');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function genOversoldBars({ n = 60, base = 1.1, oscAmp = 0.0001, declineBars = 3, declineStep = 0.0008, wick = 0.00005 } = {}) {
  const bars = [];
  let price = base;
  for (let i = 0; i < n; i += 1) {
    const delta = i < n - declineBars ? (i % 2 === 0 ? 1 : -1) * oscAmp : -declineStep;
    const open = price;
    const close = price + delta;
    const high = Math.max(open, close) + wick;
    const low = Math.min(open, close) - wick;
    bars.push({ time: 1700000000 + i * 300, open, high, low, close, tick_volume: 100 });
    price = close;
  }
  return bars;
}

const RSI_STRATEGY = {
  id: 'strategy-rsi',
  name: 'RSI Mean Reversion',
  rule_set: {
    regime_fit: { trend_quality_max: 0.4 },
    signal: { type: 'rsi_reversion', period: 14, oversold: 30, overbought: 70 },
    stop: { type: 'atr_multiple', multiple: 1.5 },
    target: { type: 'reward_risk_ratio', ratio: 2 },
    base_confidence: 0.7,
  },
};

const ARMED_INSTANCE = {
  id: 'bi-1',
  user_id: 'admin-1',
  account_type: 'real',
  m5_live_trading_confirmed_at: new Date().toISOString(),
  live_trading_confirmed_at: null, // forex Layer 2 — must be irrelevant to M5's own gate
};

function baseOverrides(overrides = {}) {
  const bars = genOversoldBars();
  const notifications = [];
  const decisions = [];
  const trades = [];
  const updateStatusFieldsCalls = [];

  return {
    tickMs: 1_000_000, // never auto-fires during tests; tick() is called explicitly
    realTradingEnabled: true,
    watchlist: ['EURUSD'],
    findBotInstanceForUser: async () => ARMED_INSTANCE,
    findInstanceById: async () => ARMED_INSTANCE,
    updateStatusFields: async (id, fields) => {
      updateStatusFieldsCalls.push({ id, fields });
      return { ...ARMED_INSTANCE, ...fields };
    },
    m5DemoDispatchService: {
      isM5DemoDispatchEnabled: async () => false,
    },
    getMatchedAccountInfoForBotInstance: async () => ({
      account_type: 'real',
      equity: 10,
      last_validated_at: new Date().toISOString(),
    }),
    listOpenTradesForUser: async () => [],
    listActiveStrategies: async () => [RSI_STRATEGY],
    getRates: async () => ({ bars }),
    getSymbolInfo: async () => ({
      bid: 1.0976,
      ask: 1.0978,
      volume_min: 0.01,
      volume_step: 0.01,
      volume_max: 20,
      trade_contract_size: 100000,
    }),
    getPositions: async () => [],
    getOrderHistory: async () => ({ close_price: 1.1, profit: 5, close_time: 1700003000 }),
    placeOrder: async () => ({ ticket: 777, price: 1.0978, volume: 0.02 }),
    insertOpenRealTrade: async (args) => {
      trades.push(args);
      return { id: 'trade-1', ...args };
    },
    closeRealTrade: async (id, args) => ({ id, ...args, status: 'closed' }),
    insertDecision: async (args) => {
      decisions.push(args);
      return args;
    },
    forceNotifyUser: async (userId, type, message) => {
      notifications.push({ userId, type, message });
      return null;
    },
    _notifications: notifications,
    _decisions: decisions,
    _trades: trades,
    _updateStatusFieldsCalls: updateStatusFieldsCalls,
    ...overrides,
  };
}

describe('m5-real-harness: start() preconditions', () => {
  it('requires an operatorUserId', async () => {
    const harness = createM5RealHarness(baseOverrides());
    await assert.rejects(() => harness.start({}), /operatorUserId is required/);
    harness._resetForTests();
  });

  it('refuses to start when M5_REAL_TRADING_ENABLED is off (Layer 1)', async () => {
    const harness = createM5RealHarness(baseOverrides({ realTradingEnabled: false }));
    await assert.rejects(
      () => harness.start({ operatorUserId: 'admin-1' }),
      (err) => err.code === 'M5_REAL_TRADING_DISABLED'
    );
    assert.equal(harness.getStatus().status, 'stopped');
    harness._resetForTests();
  });

  it('refuses to start when not confirmed (Layer 2 not armed)', async () => {
    const harness = createM5RealHarness(
      baseOverrides({
        findBotInstanceForUser: async () => ({ ...ARMED_INSTANCE, m5_live_trading_confirmed_at: null }),
        findInstanceById: async () => ({ ...ARMED_INSTANCE, m5_live_trading_confirmed_at: null }),
      })
    );
    await assert.rejects(
      () => harness.start({ operatorUserId: 'admin-1' }),
      (err) => err.code === 'M5_REAL_DISPATCH_NOT_ARMED'
    );
    harness._resetForTests();
  });

  it('refuses to start on a demo account without the M5 demo-dispatch bypass (Layer 3)', async () => {
    const demoInstance = { ...ARMED_INSTANCE, account_type: 'demo' };
    const harness = createM5RealHarness(
      baseOverrides({
        findBotInstanceForUser: async () => demoInstance,
        findInstanceById: async () => demoInstance,
      })
    );
    // account_type on the *instance* row (used by resolveArmedState, not
    // the live account-info call) is 'demo' here, and the demo-dispatch
    // bypass defaults to disabled in baseOverrides — must fail closed.
    await assert.rejects(
      () => harness.start({ operatorUserId: 'admin-1' }),
      (err) => err.code === 'M5_REAL_DISPATCH_NOT_ARMED'
    );
    harness._resetForTests();
  });

  it('starts when a real account is confirmed, independent of forex live_trading_confirmed_at', async () => {
    // ARMED_INSTANCE.live_trading_confirmed_at is null (forex not confirmed)
    // while m5_live_trading_confirmed_at is set — proves M5's gate does not
    // depend on forex's own Layer 2 state at all.
    const harness = createM5RealHarness(baseOverrides());
    const status = await harness.start({ operatorUserId: 'admin-1' });
    assert.equal(status.status, 'running');
    harness._resetForTests();
  });

  it('starts on a demo account when the M5 demo-dispatch bypass is enabled', async () => {
    const demoInstance = { ...ARMED_INSTANCE, account_type: 'demo' };
    const harness = createM5RealHarness(
      baseOverrides({
        findBotInstanceForUser: async () => demoInstance,
        findInstanceById: async () => demoInstance,
        m5DemoDispatchService: { isM5DemoDispatchEnabled: async () => true },
      })
    );
    const status = await harness.start({ operatorUserId: 'admin-1' });
    assert.equal(status.status, 'running');
    harness._resetForTests();
  });
});

describe('m5-real-harness: tick() — open path', () => {
  it('places a real order end-to-end when armed and a signal fires', async () => {
    const overrides = baseOverrides();
    const harness = createM5RealHarness(overrides);
    await harness.start({ operatorUserId: 'admin-1' });

    // start()'s first tick is fire-and-forget — wait for it to land.
    await waitUntil(() => overrides._trades.length > 0 || harness.getStatus().status === 'error');

    const status = harness.getStatus();
    assert.equal(status.status, 'running');
    assert.ok(status.openTrade);
    assert.equal(status.openTrade.brokerTicket, 777);
    assert.equal(status.decisionLog[0].type, 'opened');
    assert.equal(overrides._trades.length, 1);
    assert.equal(overrides._trades[0].assetClass, 'm5_forex_gold');
    harness._resetForTests();
  });

  it('does not open a second trade while one is already open', async () => {
    // Ticket still open at the broker throughout -> the second tick takes
    // the monitor path and leaves the position untouched. Deps are read
    // once at harness construction, so this must be set up-front rather
    // than mutated on the overrides object after the fact.
    const overrides = baseOverrides({ getPositions: async () => [{ ticket: 777 }] });
    const harness = createM5RealHarness(overrides);
    await harness.start({ operatorUserId: 'admin-1' });
    await waitUntil(() => overrides._trades.length > 0);
    const opened = harness.getStatus().openTrade;
    assert.ok(opened);

    await harness.tick();
    assert.equal(overrides._trades.length, 1, 'must not place a second order');
    assert.deepEqual(harness.getStatus().openTrade, opened);
    harness._resetForTests();
  });

  it('halts the session (status=error) when the gate degrades mid-session', async () => {
    let confirmed = new Date().toISOString();
    const overrides = baseOverrides({
      findInstanceById: async () => ({ ...ARMED_INSTANCE, m5_live_trading_confirmed_at: confirmed }),
    });
    const harness = createM5RealHarness(overrides);
    await harness.start({ operatorUserId: 'admin-1' });
    await waitUntil(() => overrides._trades.length > 0);
    assert.equal(harness.getStatus().status, 'running');

    // Simulate confirm-live expiring / being cleared mid-session, then let
    // the *next* tick observe it. The open trade must first be closed out
    // of the way so the gate check (only reached on the open path) runs.
    // Default getPositions() already returns [] (ticket gone -> monitor closes it).
    await harness.tick();
    assert.equal(harness.getStatus().openTrade, null, 'monitor tick should have closed the trade');

    confirmed = null;
    await harness.tick();

    const status = harness.getStatus();
    assert.equal(status.status, 'error');
    assert.equal(status.haltReason, 'gate_no_longer_armed');
    assert.equal(overrides._trades.length, 1, 'must not have placed a second order once un-armed');
    harness._resetForTests();
  });

  it('halts on a Layer 0 account-info failure (no infinite retry loop)', async () => {
    const overrides = baseOverrides({
      getMatchedAccountInfoForBotInstance: async () => {
        throw new Error('No IPC connection');
      },
    });
    const harness = createM5RealHarness(overrides);
    await harness.start({ operatorUserId: 'admin-1' });

    // The Layer 0 retry alone takes ~400ms (ACCOUNT_INFO_PRECHECK_RETRY_DELAY_MS).
    await waitUntil(() => harness.getStatus().status === 'error', { timeoutMs: 3000 });

    const status = harness.getStatus();
    assert.equal(status.haltReason, 'account_info_unavailable');
    assert.equal(overrides._trades.length, 0);
    harness._resetForTests();
  });
});

describe('m5-real-harness: tick() — monitor/close path', () => {
  it('reconciles a broker-side close and frees the slot for the next signal', async () => {
    const overrides = baseOverrides();
    const harness = createM5RealHarness(overrides);
    await harness.start({ operatorUserId: 'admin-1' });
    await waitUntil(() => overrides._trades.length > 0);
    assert.ok(harness.getStatus().openTrade);

    // Default getPositions() already returns [] (ticket gone at the broker).
    await harness.tick();

    const status = harness.getStatus();
    assert.equal(status.openTrade, null);
    assert.equal(status.closedTrades.length, 1);
    assert.equal(overrides._notifications.length, 2); // opened + closed
    harness._resetForTests();
  });
});

describe('m5-real-harness: stop()', () => {
  it('clears m5_live_trading_confirmed_at independently of forex live_trading_confirmed_at', async () => {
    const overrides = baseOverrides();
    const harness = createM5RealHarness(overrides);
    await harness.start({ operatorUserId: 'admin-1' });
    await harness.stop();

    assert.equal(harness.getStatus().status, 'stopped');
    assert.equal(overrides._updateStatusFieldsCalls.length, 1);
    assert.deepEqual(overrides._updateStatusFieldsCalls[0].fields, {
      m5_live_trading_confirmed_at: null,
    });
    harness._resetForTests();
  });

  it('requires an explicit stop before restarting after a halt', async () => {
    const overrides = baseOverrides({
      getMatchedAccountInfoForBotInstance: async () => {
        throw new Error('No IPC connection');
      },
    });
    const harness = createM5RealHarness(overrides);
    await harness.start({ operatorUserId: 'admin-1' });
    await waitUntil(() => harness.getStatus().status === 'error', { timeoutMs: 3000 });

    await assert.rejects(
      () => harness.start({ operatorUserId: 'admin-1' }),
      (err) => err.code === 'M5_REAL_SESSION_ERROR'
    );

    await harness.stop();
    assert.equal(harness.getStatus().status, 'stopped');
    harness._resetForTests();
  });
});
