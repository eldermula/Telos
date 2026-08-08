'use strict';

/**
 * Deterministic DRY_RUN stub for crypto headlines. Own vocabulary —
 * deliberately not an extension of forex CURRENCY_KEYWORDS.
 *
 * Impact model (docs/11 §3): crypto news is closer to an unscheduled
 * shock than a scheduled calendar surprise. Keyword tiers approximate
 * that without an LLM: structural shocks > policy/flows > chatter.
 */

const ENTITY_KEYWORDS = Object.freeze({
  BTC: ['btc', 'bitcoin', 'xbt'],
  ETH: ['eth', 'ethereum', 'ether'],
  CRYPTO: [
    'crypto',
    'cryptocurrency',
    'digital asset',
    'digital assets',
    'stablecoin',
    'defi',
    'blockchain',
  ],
});

const SHOCK_HIGH = [
  'hack',
  'hacked',
  'exploit',
  'breach',
  'halt',
  'halted',
  'insolvency',
  'bankrupt',
  'bankruptcy',
  'collapse',
  'seizure',
  'seized',
  'outage',
  'withdrawals suspended',
  'withdrawal suspended',
];

const STRUCTURAL_HIGH = [
  'etf approved',
  'etf approval',
  'spot etf',
  'sec approves',
  'banned',
  'ban on',
  'criminal charges',
  'indictment',
];

const POLICY_MEDIUM = [
  'sec ',
  'cftc',
  'regulation',
  'regulatory',
  'lawsuit',
  'sues',
  'sued',
  'enforcement',
  'compliance',
  'etf',
  'federal reserve',
  'interest rate',
];

const POSITIVE_WORDS = [
  'surge',
  'surges',
  'rally',
  'rallies',
  'soar',
  'soars',
  'approve',
  'approved',
  'approval',
  'inflow',
  'inflows',
  'adoption',
  'partnership',
  'record high',
  'all-time high',
  'higher',
  'upgrade',
];

const NEGATIVE_WORDS = [
  'plunge',
  'plunges',
  'crash',
  'crashes',
  'selloff',
  'sell-off',
  'outflow',
  'outflows',
  'reject',
  'rejected',
  'delay',
  'delayed',
  'probe',
  'investigation',
  'fraud',
  'lawsuit',
];

function detectEntities(lowerTitle) {
  const entities = [];
  for (const [tag, keywords] of Object.entries(ENTITY_KEYWORDS)) {
    if (keywords.some((k) => lowerTitle.includes(k))) entities.push(tag);
  }
  return entities;
}

function scoreSentiment(lowerTitle) {
  let score = 0;
  for (const w of POSITIVE_WORDS) {
    if (lowerTitle.includes(w)) score += 1;
  }
  for (const w of NEGATIVE_WORDS) {
    if (lowerTitle.includes(w)) score -= 1;
  }
  if (score === 0) return 0;
  return Math.max(-1, Math.min(1, score > 0 ? 0.45 + Math.min(score, 3) * 0.15 : -0.45 - Math.min(-score, 3) * 0.15));
}

function scoreImpact(lowerTitle) {
  if (SHOCK_HIGH.some((k) => lowerTitle.includes(k))) return 0.95;
  if (STRUCTURAL_HIGH.some((k) => lowerTitle.includes(k))) return 0.9;
  if (POLICY_MEDIUM.some((k) => lowerTitle.includes(k))) return 0.55;
  if (detectEntities(lowerTitle).length > 0) return 0.25;
  return 0;
}

function classifyCryptoHeadlineStub(title) {
  if (typeof title !== 'string' || !title.trim()) {
    throw new TypeError('classifyCryptoHeadlineStub requires a non-empty title');
  }
  const lower = title.toLowerCase();
  const entities = detectEntities(lower);
  if (entities.length === 0) {
    return { entities: [], sentiment: 0, impact: 0 };
  }
  return {
    entities,
    sentiment: scoreSentiment(lower),
    impact: scoreImpact(lower),
  };
}

module.exports = {
  ENTITY_KEYWORDS,
  classifyCryptoHeadlineStub,
};
