'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createXauVwapLiveHarness } = require('./xau-vwap-live-harness');
const { MIN_BARS } = require('./xau-vwap-live-strategy');

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

function genFlatBars() {
  const bars = [];
  const n = MIN_BARS;
  const start = Math.floor(Date.now() / 1000) - n * 300;
  for (let i = 0; i < n; i += 1) {
    const close = 4370 + (i % 2 === 0 ? 0.2 : -0.2);
    bars.push({
      time: start + i * 300,
      open: close,
      high: close + 0.3,
      low: close - 0.3,
      close,
      tick_volume: 100,
    });
  }
  return bars;
}

const ARMED_INSTANCE = {
  id: 'bi-xau',
  user_id: 'admin-1',
  account_type: 'demo',
  xau_vwap_live_trading_confirmed_at: new Date().toISOString(),
  halt_new_opens: false,
  m5_live_trading_confirmed_at: null,
  live_trading_confirmed_at: null,
};

function baseOverrides(overrides = {}) {
  const placeCalls = [];
  const updateStatusFieldsCalls = [];
  return {
    tickMs: 1_000_000,
    liveTradingEnabled: true,
    findBotInstanceForUser: async () => ARMED_INSTANCE,
    findInstanceById: async () => ARMED_INSTANCE,
    updateStatusFields: async (id, fields) => {
      updateStatusFieldsCalls.push({ id, fields });
      return { ...ARMED_INSTANCE, ...fields };
    },
    xauVwapDemoDispatchService: {
      isXauVwapDemoDispatchEnabled: async () => true,
    },
    getMatchedAccountInfoForBotInstance: async () => ({
      account_type: 'demo',
      equity: 100,
      last_validated_at: new Date().toISOString(),
    }),
    listOpenTradesForUser: async () => [],
    getRates: async () => ({ bars: genFlatBars() }),
    getSymbolInfo: async () => ({
      bid: 4370,
      ask: 4370.2,
      volume_min: 0.01,
      volume_step: 0.01,
      volume_max: 10,
      trade_contract_size: 100,
    }),
    getPositions: async () => [],
    placeOrder: async (a) => {
      placeCalls.push(a);
      return { ticket: 1, price: a.direction === 'BUY' ? 4370.2 : 4370, volume: a.volume };
    },
    insertOpenRealTrade: async (a) => ({ id: 't1', ...a }),
    closeRealTrade: async (id, a) => ({ id, ...a }),
    insertDecision: async () => null,
    forceNotifyUser: async () => null,
    _placeCalls: placeCalls,
    _updateStatusFieldsCalls: updateStatusFieldsCalls,
    ...overrides,
  };
}

describe('xau-vwap-live-harness: gates', () => {
  it('refuses start when Layer 1 env is off', async () => {
    const h = createXauVwapLiveHarness(baseOverrides({ liveTradingEnabled: false }));
    await assert.rejects(() => h.start({ operatorUserId: 'admin-1' }), (err) => {
      assert.equal(err.code, 'XAU_VWAP_LIVE_TRADING_DISABLED');
      return true;
    });
  });

  it('refuses start when not armed (no confirm)', async () => {
    const h = createXauVwapLiveHarness(
      baseOverrides({
        findBotInstanceForUser: async () => ({
          ...ARMED_INSTANCE,
          xau_vwap_live_trading_confirmed_at: null,
        }),
        findInstanceById: async () => ({
          ...ARMED_INSTANCE,
          xau_vwap_live_trading_confirmed_at: null,
        }),
      })
    );
    await assert.rejects(() => h.start({ operatorUserId: 'admin-1' }), (err) => {
      assert.equal(err.code, 'XAU_VWAP_LIVE_DISPATCH_NOT_ARMED');
      return true;
    });
  });

  it('refuses start when emergency halt_new_opens is true', async () => {
    const h = createXauVwapLiveHarness(
      baseOverrides({
        findBotInstanceForUser: async () => ({ ...ARMED_INSTANCE, halt_new_opens: true }),
        findInstanceById: async () => ({ ...ARMED_INSTANCE, halt_new_opens: true }),
      })
    );
    await assert.rejects(() => h.start({ operatorUserId: 'admin-1' }), (err) => {
      assert.equal(err.code, 'XAU_VWAP_LIVE_DISPATCH_NOT_ARMED');
      return true;
    });
  });

  it('starts when armed and clears confirm on stop', async () => {
    const overrides = baseOverrides();
    const h = createXauVwapLiveHarness(overrides);
    const status = await h.start({ operatorUserId: 'admin-1' });
    assert.equal(status.status, 'running');
    assert.equal(status.uiStatus, 'ENABLED');
    assert.equal(status.realMoney, true);
    assert.equal(status.instrument, 'XAUUSD');
    assert.equal(status.timeframe, 'M5');
    await waitUntil(() => h.getStatus().tickCount >= 1);
    // Flat bars → no signal → no placeOrder
    assert.equal(overrides._placeCalls.length, 0);
    await h.stop();
    assert.equal(h.getStatus().status, 'stopped');
    assert.equal(h.getStatus().uiStatus, 'DISABLED');
    assert.ok(
      overrides._updateStatusFieldsCalls.some(
        (c) => c.fields && c.fields.xau_vwap_live_trading_confirmed_at === null
      )
    );
  });

  it('does not use forex/m5 confirm columns for arming', async () => {
    const h = createXauVwapLiveHarness(
      baseOverrides({
        findBotInstanceForUser: async () => ({
          ...ARMED_INSTANCE,
          xau_vwap_live_trading_confirmed_at: null,
          live_trading_confirmed_at: new Date().toISOString(),
          m5_live_trading_confirmed_at: new Date().toISOString(),
        }),
        findInstanceById: async () => ({
          ...ARMED_INSTANCE,
          xau_vwap_live_trading_confirmed_at: null,
          live_trading_confirmed_at: new Date().toISOString(),
          m5_live_trading_confirmed_at: new Date().toISOString(),
        }),
      })
    );
    await assert.rejects(() => h.start({ operatorUserId: 'admin-1' }), (err) => {
      assert.equal(err.code, 'XAU_VWAP_LIVE_DISPATCH_NOT_ARMED');
      return true;
    });
  });
});
