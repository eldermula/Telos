'use strict';

/**
 * Option 2 E.4 — pure tick dispatcher. Separates "which methods run
 * this tick" from BotRuntime so the matrix can be unit-tested without
 * spinning up the loop.
 *
 * Monitoring uses the mode frozen onto openPosition at open time
 * (openPosition.executionMode), not this tick's resolver output — same
 * frozen-at-entry principle as appliedRisk. Missing executionMode on
 * a legacy in-memory shape defaults to 'paper'.
 *
 * `haltNewOpens` (soft-halt): when true and there is no open position,
 * returns 'skipOpen' so the tick loop stays alive for monitoring but
 * does not call openReal/openPaper. Distinct from Stop (timer cleared).
 *
 * Returns one of:
 *   'openPaper' | 'openReal' | 'monitorPaper' | 'monitorReal' | 'skipOpen'
 */
function resolveTickDispatch({ resolvedMode, openPosition, haltNewOpens = false }) {
  if (openPosition) {
    const frozen = openPosition.executionMode === 'real' ? 'real' : 'paper';
    return frozen === 'real' ? 'monitorReal' : 'monitorPaper';
  }
  if (haltNewOpens === true) {
    return 'skipOpen';
  }
  return resolvedMode === 'real' ? 'openReal' : 'openPaper';
}

module.exports = { resolveTickDispatch };
