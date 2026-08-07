'use strict';

const { isConfirmationActive } = require('./live-trading-confirmation');

/**
 * Option 2 (real order placement) — Layer 3 of the gating design
 * (CHANGELOG.md): resolves whether a bot instance's *next* trade
 * decision should execute as 'paper' or 'real'. Pure function, no I/O
 * — it doesn't know or care how its inputs were obtained (that's
 * Increment E's wiring concern), only what to do once given them.
 *
 * 'real' requires:
 *   - realTradingEnabled === true   (Layer 1 — deploy-level kill switch)
 *   - an active liveTradingConfirmedAt (Layer 2 — isConfirmationActive)
 *   - accountType that qualifies:
 *       • always: 'real'
 *       • OR, when allowDemoRealExecution === true (E1 non-production
 *         bypass from REAL_TRADING_ALLOW_DEMO): also 'demo'
 *         ('contest' never qualifies, even with the bypass)
 *
 * IMPORTANT — dispatch only. This function's return value answers
 * "which BotRuntime methods run." It must NEVER be used to derive
 * `expectedAccountType` for placeOrder/closeOrder. Layer 0 always
 * receives the true detected account_type from the broker connection
 * / connector (under E1 testing that is 'demo', not 'real'). See
 * resolveExpectedAccountTypeForLayer0.
 *
 * Any missing, null, or wrongly-typed input resolves to 'paper' —
 * fails closed rather than throwing. Returns only 'paper' | 'real'.
 */
function resolveExecutionMode({
  realTradingEnabled,
  accountType,
  liveTradingConfirmedAt,
  allowDemoRealExecution = false,
}) {
  if (realTradingEnabled !== true) {
    return 'paper';
  }

  const accountTypeQualifies =
    accountType === 'real' ||
    (allowDemoRealExecution === true && accountType === 'demo');
  if (!accountTypeQualifies) {
    return 'paper';
  }

  if (!isConfirmationActive(liveTradingConfirmedAt)) {
    return 'paper';
  }
  return 'real';
}

/**
 * Layer 0's expected_account_type — always the true detected type,
 * never rewritten by the E1 dispatch bypass. Separated from
 * resolveExecutionMode so a caller cannot accidentally pass
 * mode === 'real' into placeOrder as if it were an account type.
 */
function resolveExpectedAccountTypeForLayer0(detectedAccountType) {
  return detectedAccountType;
}

module.exports = {
  resolveExecutionMode,
  resolveExpectedAccountTypeForLayer0,
};
