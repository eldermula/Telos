'use strict';

const path = require('path');
const botInstanceRepository = require('./bot-instance.repository');
const botStatusCache = require('./bot-status.cache');
const decisionLogRepository = require('./decision-log.repository');
const tradesRepository = require('./trades.repository');
const { publishBotEvent } = require('./event-publisher');

const apirsPath = path.join(__dirname, '..', '..', '..', 'bot', 'apirs', 'src');
const { runTradeCycle } = require(path.join(apirsPath, 'paperTradingHarness.js'));

/** Default paper tick interval (ms). Overridable via PAPER_TICK_MS. */
const DEFAULT_TICK_MS = Number(process.env.PAPER_TICK_MS) || 2000;

/**
 * Stub Strategy-A signal inputs (Phase 3/4 — no AI modules yet).
 * Alternate win/loss R-multiples so circuit breakers / learning get exercise.
 */
function buildStubTradeInput(tickIndex) {
  const win = tickIndex % 2 === 0;
  return {
    strategyConfidence: 0.85,
    marketQuality: 0.7,
    trendQuality: 0.75,
    marketVolatility: 'NORMAL',
    currentATR: 1.0,
    rollingAvgATR: 1.0,
    dailyDrawdownPct: 0.02,
    outcomeRMultiple: win ? 1.5 : -1.0,
    direction: win ? 'BUY' : 'SELL',
    // Synthetic prices for trades row audit — not used by APIRS math
    entryPrice: 1.1,
    stopPrice: win ? 1.09 : 1.11,
    targetPrice: win ? 1.13 : 1.07,
  };
}

function instanceToApirsState(instance, tradeHistory) {
  return {
    balance: Number(instance.active_trading_balance),
    peakEquity: Number(instance.peak_equity),
    activeStrategyMode: instance.active_strategy_mode,
    currentTier: instance.current_tier,
    initialBalance: Number(instance.initial_balance),
    tradeHistory,
  };
}

async function persistDecisionsFromTrace(botInstanceId, previousMode, tradeInput, trace) {
  const envSnapshot = {
    trade_input: tradeInput,
    learning_inputs: trace.learningInputs || null,
    risk_result: trace.riskResult
      ? {
          appliedRisk: trace.riskResult.appliedRisk,
          riskSource: trace.riskResult.riskSource,
        }
      : null,
  };

  if (!trace.tradeApproved) {
    await decisionLogRepository.insertDecision({
      botInstanceId,
      decisionType: 'trade_rejected',
      triggeringCondition: trace.reason || 'trade_not_approved',
      details: envSnapshot,
    });
    return;
  }

  await decisionLogRepository.insertDecision({
    botInstanceId,
    decisionType: 'trade_approved',
    triggeringCondition: `paper fill pnl=${trace.pnlAmount}`,
    details: {
      ...envSnapshot,
      pnl_amount: trace.pnlAmount,
      balance_before: trace.balanceBeforeTrade,
      balance_after: trace.balanceAfterTrade,
    },
  });

  if (trace.riskResult?.microResult?.forcedToEmergencyFloor) {
    await decisionLogRepository.insertDecision({
      botInstanceId,
      decisionType: 'micro_circuit_breaker',
      triggeringCondition: 'micro circuit breaker forced emergency floor',
      details: { micro: trace.riskResult.microResult },
    });
  }

  const newMode = trace.modeResult?.activeStrategyMode;
  if (newMode && newMode !== previousMode) {
    await decisionLogRepository.insertDecision({
      botInstanceId,
      decisionType: 'strategy_switch',
      triggeringCondition: `${previousMode} → ${newMode}`,
      details: {
        from: previousMode,
        to: newMode,
        macro: trace.macroResult || null,
        mode: trace.modeResult || null,
      },
    });
    await publishBotEvent(botInstanceId, 'strategy.switched', {
      from: previousMode,
      to: newMode,
      reason: `${previousMode} → ${newMode}`,
      timestamp: new Date().toISOString(),
    });
  }

  if (trace.macroResult && newMode && newMode !== previousMode) {
    await decisionLogRepository.insertDecision({
      botInstanceId,
      decisionType: 'macro_circuit_breaker',
      triggeringCondition: `macro mode change ${previousMode} → ${newMode}`,
      details: { macro: trace.macroResult },
    });
  }

  if (trace.profitLockResult?.profitLockTriggered) {
    await decisionLogRepository.insertDecision({
      botInstanceId,
      decisionType: 'profit_lock',
      triggeringCondition: 'profit lock triggered',
      details: { profit_lock: trace.profitLockResult },
    });
  }
}

class BotRuntime {
  /**
   * @param {object} instance - bot_instances row
   * @param {{ tickMs?: number, autoTick?: boolean }} [options]
   */
  constructor(instance, options = {}) {
    this.botInstanceId = instance.id;
    this.userId = instance.user_id;
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.autoTick = options.autoTick !== false;
    this.tickIndex = 0;
    this.timer = null;
    this.running = false;
    this.state = null;
    this._tickInFlight = false;
  }

  async initialize() {
    const instance = await botInstanceRepository.findById(this.botInstanceId);
    if (!instance) {
      throw new Error(`Bot instance ${this.botInstanceId} not found`);
    }
    const tradeHistory = await tradesRepository.loadTradeHistoryForLearning(this.botInstanceId);
    this.state = instanceToApirsState(instance, tradeHistory);
  }

  start() {
    if (this.running) return;
    this.running = true;
    // Fire-and-forget — start() is sync; publish is async
    publishBotEvent(this.botInstanceId, 'bot.status_changed', {
      status: 'running',
      timestamp: new Date().toISOString(),
    }).catch((err) => console.error('[bot-runtime]', err.message));
    if (this.autoTick) {
      this.timer = setInterval(() => {
        this.tickOnce().catch((err) => {
          console.error('[bot-runtime]', this.botInstanceId, err.message);
        });
      }, this.tickMs);
      if (typeof this.timer.unref === 'function') {
        this.timer.unref();
      }
    }
  }

  async stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await publishBotEvent(this.botInstanceId, 'bot.status_changed', {
      status: 'stopped',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * One paper-trading cycle using APIRS (paperTradingHarness.runTradeCycle).
   * @param {object} [overrideInput] optional tradeInput for tests/smoke
   */
  async tickOnce(overrideInput) {
    if (!this.running) {
      return null;
    }
    if (this._tickInFlight) {
      return null;
    }
    this._tickInFlight = true;
    try {
      const tradeInput = overrideInput || buildStubTradeInput(this.tickIndex);
      this.tickIndex += 1;

      const previousMode = this.state.activeStrategyMode;
      const { state: nextState, trace } = runTradeCycle(this.state, tradeInput);
      this.state = nextState;

      await persistDecisionsFromTrace(this.botInstanceId, previousMode, tradeInput, trace);

      let tradeRow = null;
      if (trace.tradeApproved) {
        const direction = tradeInput.direction === 'SELL' ? 'SELL' : 'BUY';
        const entry = tradeInput.entryPrice ?? 1.1;
        const stop = tradeInput.stopPrice ?? entry;
        const target = tradeInput.targetPrice ?? entry;
        // Paper lot size: proportional placeholder (Module 7 not wired yet)
        const lotSize = Number((trace.riskResult.appliedRisk * 0.1).toFixed(4)) || 0.01;
        const exitPrice = trace.wasWin
          ? target
          : stop;

        tradeRow = await tradesRepository.insertClosedPaperTrade({
          botInstanceId: this.botInstanceId,
          direction,
          entryPrice: entry,
          stopPrice: stop,
          targetPrice: target,
          exitPrice,
          lotSize,
          finalAppliedPositionRisk: trace.riskResult.appliedRisk,
          pnl: trace.pnlAmount,
        });

        await publishBotEvent(this.botInstanceId, 'trade.closed', tradeRow);
      }

      const updated = await botInstanceRepository.updateStatusFields(this.botInstanceId, {
        status: 'running',
        active_strategy_mode: nextState.activeStrategyMode,
        active_trading_balance: nextState.balance,
        peak_equity: nextState.peakEquity,
        current_tier: nextState.currentTier,
      });
      const cached = await botStatusCache.setStatus(updated);

      await publishBotEvent(this.botInstanceId, 'equity.updated', {
        active_trading_balance: cached.active_trading_balance,
        peak_equity: cached.peak_equity,
        timestamp: cached.updated_at,
      });

      return { state: nextState, trace, trade: tradeRow, session: cached };
    } finally {
      this._tickInFlight = false;
    }
  }
}

/** @type {Map<string, BotRuntime>} */
const runtimes = new Map();

async function startRuntime(instance, options = {}) {
  const existing = runtimes.get(instance.id);
  if (existing) {
    if (!existing.running) {
      await existing.initialize();
      existing.start();
    }
    return existing;
  }
  const runtime = new BotRuntime(instance, options);
  await runtime.initialize();
  runtime.start();
  runtimes.set(instance.id, runtime);
  return runtime;
}

async function stopRuntime(botInstanceId) {
  const runtime = runtimes.get(botInstanceId);
  if (!runtime) return;
  await runtime.stop();
  runtimes.delete(botInstanceId);
}

function getRuntime(botInstanceId) {
  return runtimes.get(botInstanceId) || null;
}

module.exports = {
  BotRuntime,
  buildStubTradeInput,
  startRuntime,
  stopRuntime,
  getRuntime,
  DEFAULT_TICK_MS,
};
