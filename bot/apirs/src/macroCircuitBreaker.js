'use strict';

const {
  MACRO_MAX_DRAWDOWN_PCT,
  MACRO_HALT_DRAWDOWN_PCT,
  STRATEGY_B_FLAT_RISK,
  STRATEGY_B_MIN_CONFIDENCE,
} = require('./constants');

const STRATEGY_A = 'STRATEGY_A';
const STRATEGY_B = 'STRATEGY_B';
const HALTED = 'HALTED';
const VALID_MODES = new Set([STRATEGY_A, STRATEGY_B, HALTED]);

// Section 6.1 recovery hysteresis: "within half the macro drawdown
// threshold from peak" — derived from MACRO_MAX_DRAWDOWN_PCT rather than
// hardcoded, so the two stay in sync if the macro threshold ever changes.
const STRATEGY_B_RECOVERY_DRAWDOWN_PCT = MACRO_MAX_DRAWDOWN_PCT / 2; // 0.225

function assertValidMode(mode, name) {
  if (!VALID_MODES.has(mode)) {
    throw new RangeError(`${name} must be one of ${[...VALID_MODES].join(', ')}, got ${mode}`);
  }
}

/**
 * 08_Bot_Architecture.md Section 6 (Macro Circuit Breaker) + Section 6.1
 * (Strategy B / STRATEGY_B_OR_HALT resolution).
 *
 * Pure function: given current account state and strategy mode, returns
 * the updated peak equity, drawdown, and resolved strategy mode after
 * applying the two-stage failsafe:
 *
 *   STRATEGY_A --(drawdown >= 45% from peak)--> STRATEGY_B
 *   STRATEGY_B --(drawdown >= 60% from peak)--> HALTED
 *   STRATEGY_B --(drawdown  < 22.5% from peak)--> STRATEGY_A
 *
 * STRATEGY_A never transitions directly to HALTED, even within a single
 * evaluation where a single loss numerically clears both thresholds at
 * once (realistic at Section 3a bootstrap risk levels) — it always lands
 * in STRATEGY_B first, per the spec's explicit "never jumps straight to a
 * full halt" resolution. HALTED is terminal here: this function never
 * exits it on its own, since the spec requires mandatory manual
 * re-enable, which is an operational action outside APIRS's
 * deterministic core.
 */
function evaluateMacroCircuitBreaker({ activeTradingBalance, peakEquity, activeStrategyMode }) {
  if (!Number.isFinite(activeTradingBalance)) {
    throw new RangeError(`activeTradingBalance must be a finite number, got ${activeTradingBalance}`);
  }
  if (!Number.isFinite(peakEquity) || peakEquity <= 0) {
    throw new RangeError(`peakEquity must be a positive finite number, got ${peakEquity}`);
  }
  assertValidMode(activeStrategyMode, 'activeStrategyMode');

  // Rule 1: peak equity is a running max, updated unconditionally.
  const newPeakEquity = Math.max(peakEquity, activeTradingBalance);
  const drawdownFromPeak = (newPeakEquity - activeTradingBalance) / newPeakEquity;

  let newMode = activeStrategyMode;
  let macroBreachTriggered = false;
  let haltTriggered = false;
  let recoveredToStrategyA = false;

  if (activeStrategyMode === HALTED) {
    // Terminal state — requires manual re-enable, not handled here.
  } else if (activeStrategyMode === STRATEGY_B) {
    if (drawdownFromPeak >= MACRO_HALT_DRAWDOWN_PCT) {
      newMode = HALTED;
      haltTriggered = true;
    } else if (drawdownFromPeak < STRATEGY_B_RECOVERY_DRAWDOWN_PCT) {
      newMode = STRATEGY_A;
      recoveredToStrategyA = true;
    }
  } else {
    // STRATEGY_A
    if (drawdownFromPeak >= MACRO_MAX_DRAWDOWN_PCT) {
      newMode = STRATEGY_B;
      macroBreachTriggered = true;
    }
  }

  return {
    peakEquity: newPeakEquity,
    drawdownFromPeak,
    activeStrategyMode: newMode,
    strategySwitched: newMode !== activeStrategyMode,
    macroBreachTriggered,
    haltTriggered,
    recoveredToStrategyA,
    // Rule 3: entering Strategy B or Halted kills exposure + notifies.
    // Signals only — the Execution/Notification systems (later phases)
    // act on these; this module has no side effects of its own.
    killActiveExposure: macroBreachTriggered || haltTriggered,
    emergencyNotificationRequired: macroBreachTriggered || haltTriggered,
  };
}

/**
 * Section 6.1 — Strategy B's raised confidence bar: only the
 * highest-conviction setups are allowed through while defending capital.
 */
function isTradeAllowedUnderStrategyB(strategyConfidence) {
  if (!Number.isFinite(strategyConfidence) || strategyConfidence < 0 || strategyConfidence > 1) {
    throw new RangeError(`strategyConfidence must be a finite number in [0, 1], got ${strategyConfidence}`);
  }
  return strategyConfidence >= STRATEGY_B_MIN_CONFIDENCE;
}

/**
 * Section 6.1 — flat 1% risk while in Strategy B, ignoring the Section 3
 * tier ceilings entirely.
 */
function getStrategyBRisk() {
  return STRATEGY_B_FLAT_RISK;
}

/**
 * Section 6.1 — tier/milestone progression is frozen while not in
 * STRATEGY_A. Exposed as a pure check for the future orchestrator to
 * consult before invoking Section 5's evaluateProfitLock; not wired
 * automatically here since that integration belongs to the
 * orchestration layer, not to Section 6 itself.
 */
function isTierProgressionFrozen(activeStrategyMode) {
  assertValidMode(activeStrategyMode, 'activeStrategyMode');
  return activeStrategyMode !== STRATEGY_A;
}

module.exports = {
  STRATEGY_A,
  STRATEGY_B,
  HALTED,
  STRATEGY_B_RECOVERY_DRAWDOWN_PCT,
  evaluateMacroCircuitBreaker,
  isTradeAllowedUnderStrategyB,
  getStrategyBRisk,
  isTierProgressionFrozen,
};
