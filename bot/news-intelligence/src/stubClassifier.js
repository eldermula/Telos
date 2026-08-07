'use strict';

// DRY_RUN placeholder for the real Claude/OpenAI headline parse
// (08_Bot_Architecture.md Section 9.0/9.4 — either provider is
// acceptable per FR-BOT-1). No API key is configured yet, so this
// deterministic keyword matcher is the *only* classification path for
// 6.3 — not a fallback branch that silently activates if a key is
// missing. Deliberately naive, NOT a substitute for real language
// understanding — good enough to exercise the rest of Module 3's
// pipeline (dedup/fan-out/aggregation/caching) end to end without
// spending money or blocking on a key. Swapping this for a real batched
// LLM call later is a single-function replacement — everything
// downstream consumes the same `{entities, sentiment, impact}` shape
// regardless of which implementation produced it.

const CURRENCY_KEYWORDS = {
  USD: ['usd', 'dollar', 'fed', 'fomc', 'nfp', 'non-farm', 'nonfarm', 'payroll', 'powell', 'treasury'],
  EUR: ['eur', 'euro', 'ecb', 'lagarde', 'eurozone'],
  GBP: ['gbp', 'pound', 'sterling', 'boe', 'bailey'],
  JPY: ['jpy', 'yen', 'boj', 'ueda', 'japan'],
  AUD: ['aud', 'aussie', 'rba', 'australia'],
  CAD: ['cad', 'loonie', 'canada', 'boc'],
  // Not a real currency code — a synthetic tag for gold/safe-haven
  // language, resolved directly to XAUUSD by fanOut.js rather than
  // through the currency->pairs table other entities use.
  XAU: ['gold', 'xau', 'safe haven', 'safe-haven', 'silver'],
};

const POSITIVE_WORDS = [
  'rise', 'rises', 'rose', 'gain', 'gains', 'advance', 'advances', 'strengthen', 'strengthens',
  'beat', 'beats', 'hike', 'hikes', 'surge', 'surges', 'rally', 'rallies', 'higher', 'jumps',
];
const NEGATIVE_WORDS = [
  'fall', 'falls', 'fell', 'drop', 'drops', 'weaken', 'weakens', 'miss', 'misses', 'cut', 'cuts',
  'recession', 'plunge', 'plunges', 'slump', 'slumps', 'lower', 'tumbles',
];

function detectEntities(lowerTitle) {
  const entities = [];
  for (const [tag, keywords] of Object.entries(CURRENCY_KEYWORDS)) {
    if (keywords.some((kw) => lowerTitle.includes(kw))) {
      entities.push(tag);
    }
  }
  return entities;
}

function countMatches(lowerTitle, words) {
  return words.reduce((count, w) => (lowerTitle.includes(w) ? count + 1 : count), 0);
}

/**
 * DRY_RUN stand-in for Module 3's real LLM headline parse. Given one
 * headline title, returns `{entities, sentiment, impact}` — `entities`
 * are currency codes (plus the synthetic `"XAU"` tag), `sentiment` is
 * -1..1 (naive keyword polarity, 0 if no signal words matched),
 * `impact` is 0..1 (naive magnitude from how much signal language and
 * how many entities the headline packs in).
 */
function classifyHeadlineStub(title) {
  if (typeof title !== 'string' || !title.trim()) {
    throw new TypeError('classifyHeadlineStub requires a non-empty title string');
  }
  const lower = title.toLowerCase();
  const entities = detectEntities(lower);

  const positiveHits = countMatches(lower, POSITIVE_WORDS);
  const negativeHits = countMatches(lower, NEGATIVE_WORDS);
  const totalHits = positiveHits + negativeHits;
  const sentiment = totalHits === 0 ? 0 : (positiveHits - negativeHits) / totalHits;

  const impact = Math.max(0, Math.min(1, (totalHits + entities.length) / 5));

  return { entities, sentiment, impact };
}

module.exports = { classifyHeadlineStub, CURRENCY_KEYWORDS };
