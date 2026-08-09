'use strict';

/**
 * Synthetics paper-mode dispatcher — Volatility Indices watchlist.
 *
 * Own tick loop. Never imports bot-runtime.js or crypto-bot-runtime.js.
 * Never calls MT5 order placement (Batch 2). Batch 1: Layer 3 resolver
 * is invoked per tick for logging only.
 *
 * Shared writers: trades / decision-log / WS with asset_class='synthetic'.
 * System-wide one-open guard via listOpenTradesForUser + DB unique index.
 * News: fixed neutral (intentional exclusion — docs/11 §3).
 */

const path = require('path');
const botInstanceRepository = require('./bot-instance.repository');
const botStatusCache = require('./bot-status.cache');
const decisionLogRepository = require('./decision-log.repository');
const tradesRepository = require('./trades.repository');
const { publishBotEvent } = require('./event-publisher');
const mt5Connector = require('../services/mt5-connector.client');
const syntheticStrategySelectionService = require('./synthetic-strategy-selection.service');
const notificationsService = require('../services/notifications.service');
const riskTierConfigService = require('./risk-tier-config.service');
const { normalizeSyntheticContractSpec } = require('./synthetic-contract-specs');
const {
  nextDailyDrawdownMarkers,
  shrinkDailyDrawdownMarkersForProfitLock,
} = require('./daily-drawdown');
const {
  SYNTHETIC_REAL_TRADING_ENABLED,
  REAL_TRADING_ALLOW_DEMO,
} = require('../config/env');
const { resolveExecutionMode } = require('./execution-mode');

const apirsPath = path.join(__dirname, '..', '..', '..', 'bot', 'apirs', 'src');
const { evaluateEntry, resolveExit } = require(path.join(apirsPath, 'paperTradingHarness.js'));
const { computeLiveWinProbability, computeConsecutiveLosses } = require(
  path.join(apirsPath, 'learningEngine.js')
);

const DEFAULT_TICK_MS =
  Number(process.env.SYNTHETIC_PAPER_TICK_MS) || Number(process.env.PAPER_TICK_MS) || 2000;
const ASSET_CLASS = 'synthetic';

function markersFromInstance(instance) {
  return {
    day: instance.daily_drawdown_day ?? null,
    startEquity:
      instance.daily_start_equity == null ? null : Number(instance.daily_start_equity),
    peakEquity:
      instance.daily_peak_equity == null ? null : Number(instance.daily_peak_equity),
  };
}

function dailyFieldsFromMarkers(markers) {
  if (!markers) {
    return {
      daily_drawdown_day: null,
      daily_start_equity: null,
      daily_peak_equity: null,
    };
  }
  return {
    daily_drawdown_day: markers.day,
    daily_start_equity: markers.startEquity,
    daily_peak_equity: markers.peakEquity,
  };
}

function markersChanged(prev, next) {
  if (!prev) return true;
  return (
    prev.day !== next.day ||
    Number(prev.startEquity) !== Number(next.startEquity) ||
    Number(prev.peakEquity) !== Number(next.peakEquity)
  );
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

async function logEntryDecision(botInstanceId, tradeInput, entryResult, selection) {
  const selectionSummary = {
    chosen_instrument: selection.chosen_instrument,
    strategy_name: selection.strategy_name,
    strategy_id: selection.strategy_id,
  };

  if (!entryResult.tradeApproved) {
    await decisionLogRepository.insertDecision({
      botInstanceId,
      decisionType: 'trade_rejected',
      triggeringCondition: entryResult.reason || 'trade_not_approved',
      details: { trade_input: tradeInput, selection: selectionSummary },
      assetClass: ASSET_CLASS,
    });
    return;
  }

  await decisionLogRepository.insertDecision({
    botInstanceId,
    decisionType: 'trade_approved',
    triggeringCondition: `${tradeInput.direction} ${selection.chosen_instrument} opened via ${selection.strategy_name}, applied_risk=${entryResult.riskResult.appliedRisk}`,
    details: {
      trade_input: tradeInput,
      selection: selectionSummary,
      risk_result: {
        appliedRisk: entryResult.riskResult.appliedRisk,
        riskSource: entryResult.riskResult.riskSource,
      },
    },
    assetClass: ASSET_CLASS,
  });
}

async function logExitDecisions(botInstanceId, userId, previousMode, trace) {
  await decisionLogRepository.insertDecision({
    botInstanceId,
    decisionType: 'trade_closed',
    triggeringCondition: `resolved pnl=${trace.pnlAmount}`,
    details: {
      pnl_amount: trace.pnlAmount,
      balance_before: trace.balanceBeforeTrade,
      balance_after: trace.balanceAfterTrade,
      was_win: trace.wasWin,
    },
    assetClass: ASSET_CLASS,
  });

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
      assetClass: ASSET_CLASS,
    });
    await publishBotEvent(botInstanceId, 'strategy.switched', {
      from: previousMode,
      to: newMode,
      reason: `${previousMode} → ${newMode}`,
      timestamp: new Date().toISOString(),
    });
    await notificationsService.maybeNotifyUser(
      userId,
      'strategy_switch',
      `Strategy switched ${previousMode} → ${newMode}.`
    );
  }
}

class SyntheticBotRuntime {
  /**
   * @param {object} instance bot_instances row
   * @param {{ tickMs?: number, autoTick?: boolean, strategySelection?: object }} [options]
   */
  constructor(instance, options = {}) {
    this.botInstanceId = instance.id;
    this.userId = instance.user_id;
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.autoTick = options.autoTick !== false;
    this.strategySelection = options.strategySelection || syntheticStrategySelectionService;
    this.getSymbolInfo = options.getSymbolInfo || ((s) => mt5Connector.getSymbolInfo(s));
    this.timer = null;
    this.running = false;
    this.state = null;
    this.openPosition = null;
    this.dailyDrawdownMarkers = null;
    this._tickInFlight = false;
  }

  async _refreshDailyDrawdown(currentEquity, { now, persist = true } = {}) {
    const prev = this.dailyDrawdownMarkers;
    const result = nextDailyDrawdownMarkers({
      now: now || new Date(),
      currentEquity,
      markers: prev,
    });
    this.dailyDrawdownMarkers = result.markers;
    if (persist && markersChanged(prev, result.markers)) {
      await botInstanceRepository.updateStatusFields(
        this.botInstanceId,
        dailyFieldsFromMarkers(result.markers)
      );
    }
    return result;
  }

  _shrinkDailyDrawdownForProfitLock(trace, currentEquity) {
    if (!trace?.profitLockResult?.profitLockTriggered) {
      return false;
    }
    this.dailyDrawdownMarkers = shrinkDailyDrawdownMarkersForProfitLock({
      markers: this.dailyDrawdownMarkers,
      lockedProfitAmount: trace.profitLockResult.lockedProfitAmount,
      currentEquity,
    });
    return true;
  }

  async initialize() {
    const instance = await botInstanceRepository.findById(this.botInstanceId);
    if (!instance) {
      throw new Error(`Bot instance ${this.botInstanceId} not found`);
    }
    const tradeHistory = await tradesRepository.loadTradeHistoryForLearning(this.botInstanceId);
    this.state = instanceToApirsState(instance, tradeHistory);
    this.dailyDrawdownMarkers = markersFromInstance(instance);

    const openTrades = await tradesRepository.listOpenSyntheticTradesForResume(this.botInstanceId);
    if (openTrades.length > 0) {
      const row = openTrades[0];
      const appliedRisk = Number(row.final_applied_position_risk);
      this.openPosition = {
        tradeRowId: row.id,
        symbol: row.symbol,
        direction: row.direction,
        entryPrice: Number(row.entry_price),
        stopPrice: Number(row.stop_price),
        targetPrice: Number(row.target_price),
        executionMode: 'paper',
        conditions: row.conditions ?? null,
        entryResult: {
          tradeApproved: true,
          learningInputs: {
            liveWinProbability: computeLiveWinProbability(tradeHistory),
            consecutiveLosses: computeConsecutiveLosses(tradeHistory),
          },
          riskResult: { appliedRisk, riskSource: 'resumed_after_restart' },
          balanceBeforeTrade: this.state.balance,
          riskedAmount: appliedRisk * this.state.balance,
        },
      };
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    if (!this.autoTick) return;
    this.timer = setInterval(() => {
      this.tickOnce().catch((err) => {
        console.error('[synthetic-bot-runtime] tick failed:', err.message);
      });
    }, this.tickMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  async stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tickOnce() {
    if (this._tickInFlight) return null;
    this._tickInFlight = true;
    try {
      // Batch 1 Layer 3 — resolve mode for observability only. Do not
      // dispatch real opens/closes here (Batch 2).
      const resolvedMode = await this._resolveExecutionModeForTick();
      console.log(
        `[synthetic-bot-runtime] resolved execution_mode=${resolvedMode} ` +
          `bot=${this.botInstanceId} (log-only; paper path continues)`
      );

      if (this.openPosition) {
        return await this._monitorOpenPositionPaper();
      }
      const anyOpen = await tradesRepository.listOpenTradesForUser(this.userId);
      if (anyOpen.length > 0) {
        return null;
      }
      return await this._maybeOpenPositionPaper();
    } finally {
      this._tickInFlight = false;
    }
  }

  /**
   * Layer 3 — per-tick freshness. Uses SYNTHETIC_REAL_TRADING_ENABLED and
   * synthetic_live_trading_confirmed_at (not the forex counterparts).
   * account_type comes from the linked broker_connections row (joined in
   * bot-instance.repository), same pattern as forex BotRuntime.
   */
  async _resolveExecutionModeForTick() {
    const instance = await botInstanceRepository.findById(this.botInstanceId);
    if (!instance) {
      return 'paper';
    }
    return resolveExecutionMode({
      realTradingEnabled: SYNTHETIC_REAL_TRADING_ENABLED,
      accountType: instance.account_type,
      liveTradingConfirmedAt: instance.synthetic_live_trading_confirmed_at,
      allowDemoRealExecution: REAL_TRADING_ALLOW_DEMO,
    });
  }

  async _maybeOpenPositionPaper() {
    const dd = await this._refreshDailyDrawdown(this.state.balance);

    const selection = await this.strategySelection.selectSyntheticTradeAcrossWatchlist();
    if (!selection) {
      return null;
    }

    const tradeInput = {
      strategyConfidence: selection.strategy_confidence,
      marketQuality: selection.newsIntelligence?.market_quality ?? 0.5,
      trendQuality: selection.marketIntelligence.trend_quality,
      marketVolatility: selection.marketIntelligence.market_volatility,
      currentATR: selection.marketIntelligence.diagnostics.currentATR,
      rollingAvgATR: selection.marketIntelligence.diagnostics.rollingAvgATR,
      dailyDrawdownPct: dd.dailyDrawdownPct,
      direction: selection.direction,
    };

    const tierRows = await riskTierConfigService.getTierRows();
    const entryResult = evaluateEntry(this.state, tradeInput, { tierRows });
    await logEntryDecision(this.botInstanceId, tradeInput, entryResult, selection);

    if (!entryResult.tradeApproved) {
      return { state: this.state, entryResult, trade: null };
    }

    const symbol = selection.chosen_instrument;
    let symbolInfo;
    try {
      symbolInfo = await this.getSymbolInfo(symbol);
    } catch (err) {
      console.error('[synthetic-bot-runtime] price fetch failed, will retry next tick:', err.message);
      return null;
    }
    if (
      symbolInfo.bid == null ||
      symbolInfo.ask == null ||
      !(Number(symbolInfo.bid) > 0) ||
      !(Number(symbolInfo.ask) > 0)
    ) {
      console.error('[synthetic-bot-runtime] MT5 returned no usable live tick for', symbol);
      return null;
    }

    const spec = normalizeSyntheticContractSpec({ ...symbolInfo, symbol });
    if (!spec.sizingReady) {
      await decisionLogRepository.insertDecision({
        botInstanceId: this.botInstanceId,
        decisionType: 'trade_rejected',
        triggeringCondition: 'synthetic_contract_spec_not_sizing_ready',
        details: { symbol, reason: spec.reason || null, spec },
        assetClass: ASSET_CLASS,
      });
      return { state: this.state, entryResult, trade: null, specRejected: true };
    }

    const direction = selection.direction;
    const entryPrice = direction === 'BUY' ? symbolInfo.ask : symbolInfo.bid;
    const { stopPrice, targetPrice } = this.strategySelection.computeSelectionStopTarget(
      selection,
      entryPrice
    );
    const lotSize = Number((entryResult.riskResult.appliedRisk * 0.1).toFixed(4)) || 0.01;

    const conditions = {
      ...tradeInput,
      strategy_id: selection.strategy_id,
      strategy_name: selection.strategy_name,
      trade_contract_size: spec.trade_contract_size,
      asset_class: ASSET_CLASS,
    };

    let tradeRow;
    try {
      tradeRow = await tradesRepository.insertOpenPaperTrade({
        botInstanceId: this.botInstanceId,
        symbol,
        direction,
        entryPrice,
        stopPrice,
        targetPrice,
        lotSize,
        finalAppliedPositionRisk: entryResult.riskResult.appliedRisk,
        conditions,
        assetClass: ASSET_CLASS,
      });
    } catch (err) {
      if (err && err.code === '23505') {
        console.warn('[synthetic-bot-runtime] open blocked by one_open_trade_per_user');
        return null;
      }
      throw err;
    }

    this.openPosition = {
      tradeRowId: tradeRow.id,
      symbol,
      direction,
      entryPrice,
      stopPrice,
      targetPrice,
      executionMode: 'paper',
      conditions,
      entryResult,
    };

    await publishBotEvent(this.botInstanceId, 'trade.opened', tradeRow);
    return { state: this.state, entryResult, trade: tradeRow };
  }

  async _monitorOpenPositionPaper() {
    const pos = this.openPosition;

    let symbolInfo;
    try {
      symbolInfo = await this.getSymbolInfo(pos.symbol);
    } catch (err) {
      console.error('[synthetic-bot-runtime] price fetch failed, will retry next tick:', err.message);
      return null;
    }
    if (
      symbolInfo.bid == null ||
      symbolInfo.ask == null ||
      !(Number(symbolInfo.bid) > 0) ||
      !(Number(symbolInfo.ask) > 0)
    ) {
      return null;
    }

    const current = pos.direction === 'BUY' ? symbolInfo.bid : symbolInfo.ask;

    let hit = null;
    if (pos.direction === 'BUY') {
      if (current >= pos.targetPrice) hit = 'target';
      else if (current <= pos.stopPrice) hit = 'stop';
    } else {
      if (current <= pos.targetPrice) hit = 'target';
      else if (current >= pos.stopPrice) hit = 'stop';
    }

    if (!hit) {
      return null;
    }

    const exitPrice = current;
    const stopDistance = Math.abs(pos.entryPrice - pos.stopPrice);
    const signedMove = (exitPrice - pos.entryPrice) * (pos.direction === 'BUY' ? 1 : -1);
    const realRMultiple = stopDistance > 0 ? signedMove / stopDistance : 0;
    const pnlAmount = pos.entryResult.riskedAmount * realRMultiple;
    const wasWin = pnlAmount > 0;

    const tierRows = await riskTierConfigService.getTierRows();
    const previousMode = this.state.activeStrategyMode;
    const { state: nextState, trace } = resolveExit(
      this.state,
      pos.entryResult,
      {
        wasWin,
        pnlAmount,
        conditions: pos.conditions ?? null,
      },
      { tierRows }
    );
    this.state = nextState;
    this._shrinkDailyDrawdownForProfitLock(trace, nextState.balance);
    const ddClose = await this._refreshDailyDrawdown(nextState.balance, { persist: false });

    const closedTrade = await tradesRepository.closePaperTrade(pos.tradeRowId, {
      exitPrice,
      pnl: pnlAmount,
    });

    await logExitDecisions(this.botInstanceId, this.userId, previousMode, trace);

    if (closedTrade) {
      await publishBotEvent(this.botInstanceId, 'trade.closed', closedTrade);
    }

    const updated = await botInstanceRepository.updateStatusFields(this.botInstanceId, {
      synthetic_status: 'running',
      active_strategy_mode: nextState.activeStrategyMode,
      active_trading_balance: nextState.balance,
      peak_equity: nextState.peakEquity,
      current_tier: nextState.currentTier,
      ...dailyFieldsFromMarkers(ddClose.markers),
    });
    const cached = await botStatusCache.setStatus(updated);

    await publishBotEvent(this.botInstanceId, 'equity.updated', {
      active_trading_balance: cached.active_trading_balance,
      peak_equity: cached.peak_equity,
      timestamp: cached.updated_at,
    });

    this.openPosition = null;
    return { state: nextState, trace, trade: closedTrade, session: cached };
  }
}

/** @type {Map<string, SyntheticBotRuntime>} */
const syntheticRuntimes = new Map();

async function startSyntheticRuntime(instance, options = {}) {
  const existing = syntheticRuntimes.get(instance.id);
  if (existing) {
    if (!existing.running) {
      await existing.initialize();
      existing.start();
    }
    return existing;
  }
  const runtime = new SyntheticBotRuntime(instance, options);
  await runtime.initialize();
  syntheticRuntimes.set(instance.id, runtime);
  runtime.start();
  return runtime;
}

async function stopSyntheticRuntime(botInstanceId) {
  const runtime = syntheticRuntimes.get(botInstanceId);
  if (!runtime) return;
  await runtime.stop();
  syntheticRuntimes.delete(botInstanceId);
}

function getSyntheticRuntime(botInstanceId) {
  return syntheticRuntimes.get(botInstanceId) || null;
}

module.exports = {
  SyntheticBotRuntime,
  startSyntheticRuntime,
  stopSyntheticRuntime,
  getSyntheticRuntime,
  DEFAULT_TICK_MS,
  ASSET_CLASS,
};
