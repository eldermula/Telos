'use strict';

/**
 * Soft-halt: tick loop stays alive for monitoring; new opens are blocked.
 * Covers forex BotRuntime and SyntheticBotRuntime.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { BotRuntime } = require('./bot-runtime');
const { SyntheticBotRuntime } = require('./synthetic-bot-runtime');

function makeOpenRealPosition(overrides = {}) {
  return {
    tradeRowId: 'trade-1',
    symbol: 'EURUSD',
    direction: 'BUY',
    entryPrice: 1.1,
    stopPrice: 1.09,
    targetPrice: 1.12,
    executionMode: 'real',
    brokerTicket: 9001,
    conditions: {},
    entryResult: {
      tradeApproved: true,
      learningInputs: { liveWinProbability: 0.5, consecutiveLosses: 0 },
      riskResult: { appliedRisk: 0.01, riskSource: 'test' },
      balanceBeforeTrade: 10000,
      riskedAmount: 100,
    },
    historyRetryCount: 0,
    ...overrides,
  };
}

describe('forex BotRuntime soft-halt (halt_new_opens)', () => {
  it('blocks open paths but continues monitorReal when halted', async () => {
    let openPaper = 0;
    let openReal = 0;
    let monitorReal = 0;
    let monitorPaper = 0;

    const runtime = new BotRuntime(
      { id: 'bot-1', user_id: 'user-1' },
      { autoTick: false }
    );
    runtime.running = true;
    runtime.state = {
      balance: 10000,
      peakEquity: 10000,
      activeStrategyMode: 'STRATEGY_A',
      currentTier: 0,
      initialBalance: 10000,
      tradeHistory: [],
    };
    runtime._resolveTickContext = async () => ({
      resolvedMode: 'paper',
      haltNewOpens: true,
    });

    runtime._maybeOpenPositionPaper = async () => {
      openPaper += 1;
      return null;
    };
    runtime._maybeOpenPositionReal = async () => {
      openReal += 1;
      return null;
    };
    runtime._monitorOpenPositionPaper = async () => {
      monitorPaper += 1;
      return null;
    };
    runtime._monitorOpenPositionReal = async () => {
      monitorReal += 1;
      return null;
    };

    runtime.openPosition = null;
    await runtime.tickOnce();
    assert.equal(openPaper, 0);
    assert.equal(openReal, 0);
    assert.equal(monitorReal, 0);

    runtime.openPosition = makeOpenRealPosition();
    await runtime.tickOnce();
    assert.equal(monitorReal, 1);
    assert.equal(openPaper, 0);
    assert.equal(openReal, 0);
    assert.equal(monitorPaper, 0);
  });

  it('allows openPaper when halt_new_opens is false', async () => {
    let openPaper = 0;
    const runtime = new BotRuntime(
      { id: 'bot-1', user_id: 'user-1' },
      { autoTick: false }
    );
    runtime.running = true;
    runtime.state = {
      balance: 10000,
      peakEquity: 10000,
      activeStrategyMode: 'STRATEGY_A',
      currentTier: 0,
      initialBalance: 10000,
      tradeHistory: [],
    };
    runtime.openPosition = null;
    runtime._resolveTickContext = async () => ({
      resolvedMode: 'paper',
      haltNewOpens: false,
    });
    runtime._maybeOpenPositionPaper = async () => {
      openPaper += 1;
      return null;
    };
    await runtime.tickOnce();
    assert.equal(openPaper, 1);
  });
});

describe('synthetic BotRuntime soft-halt (synthetic_halt_new_opens)', () => {
  it('blocks open paths but continues monitorReal when halted', async () => {
    let openPaper = 0;
    let openReal = 0;
    let monitorReal = 0;

    const instance = {
      id: 'bot-syn-1',
      user_id: 'user-1',
      account_type: 'demo',
      synthetic_status: 'running',
      synthetic_halt_new_opens: true,
      synthetic_live_trading_confirmed_at: null,
      synthetic_active_trading_balance: 10000,
      synthetic_peak_equity: 10000,
      synthetic_initial_balance: 10,
      synthetic_current_tier: 0,
      active_strategy_mode: 'STRATEGY_A',
      daily_drawdown_day: null,
      daily_start_equity: null,
      daily_peak_equity: null,
    };

    const runtime = new SyntheticBotRuntime(instance, { autoTick: false });
    runtime.running = true;
    runtime.state = {
      balance: 10000,
      peakEquity: 10000,
      activeStrategyMode: 'STRATEGY_A',
      currentTier: 0,
      initialBalance: 10,
      tradeHistory: [],
    };
    runtime._resolveTickContext = async () => ({
      resolvedMode: 'paper',
      haltNewOpens: true,
    });
    runtime._reconcileSyntheticRealAgainstBroker = async () => {};

    runtime._maybeOpenPositionPaper = async () => {
      openPaper += 1;
      return null;
    };
    runtime._maybeOpenPositionReal = async () => {
      openReal += 1;
      return null;
    };
    runtime._monitorOpenPositionReal = async () => {
      monitorReal += 1;
      return null;
    };

    runtime.openPosition = null;
    await runtime.tickOnce();
    assert.equal(openPaper, 0);
    assert.equal(openReal, 0);

    runtime.openPosition = {
      ...makeOpenRealPosition({ symbol: 'Volatility 10 Index' }),
    };
    await runtime.tickOnce();
    assert.equal(monitorReal, 1);
    assert.equal(openPaper, 0);
    assert.equal(openReal, 0);
  });
});
