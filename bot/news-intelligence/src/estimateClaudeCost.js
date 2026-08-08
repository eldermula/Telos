'use strict';

/**
 * Estimate USD cost from Anthropic token usage.
 * Rates are $/million tokens (MTok), matching Anthropic's public pricing units.
 *
 * @param {{
 *   inputTokens: number,
 *   outputTokens: number,
 *   inputUsdPerMTok?: number,
 *   outputUsdPerMTok?: number,
 * }} args
 * @returns {number} estimated USD (not rounded)
 */
function estimateClaudeCostUsd({
  inputTokens,
  outputTokens,
  inputUsdPerMTok = 3,
  outputUsdPerMTok = 15,
}) {
  if (!Number.isFinite(inputTokens) || inputTokens < 0) {
    throw new RangeError(`inputTokens must be a non-negative finite number, got ${inputTokens}`);
  }
  if (!Number.isFinite(outputTokens) || outputTokens < 0) {
    throw new RangeError(`outputTokens must be a non-negative finite number, got ${outputTokens}`);
  }
  if (!Number.isFinite(inputUsdPerMTok) || inputUsdPerMTok < 0) {
    throw new RangeError(`inputUsdPerMTok must be a non-negative finite number, got ${inputUsdPerMTok}`);
  }
  if (!Number.isFinite(outputUsdPerMTok) || outputUsdPerMTok < 0) {
    throw new RangeError(`outputUsdPerMTok must be a non-negative finite number, got ${outputUsdPerMTok}`);
  }
  return (inputTokens / 1e6) * inputUsdPerMTok + (outputTokens / 1e6) * outputUsdPerMTok;
}

module.exports = { estimateClaudeCostUsd };