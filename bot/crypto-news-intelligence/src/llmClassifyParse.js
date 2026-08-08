'use strict';

/**
 * Crypto LLM classification helpers — distinct prompt + impact model
 * from forex Module 3 (docs/11 §3). Same wire shape:
 * { entities, sentiment, impact }.
 */

const { ENTITY_KEYWORDS } = require('./stubClassifier');

const ALLOWED_ENTITIES = Object.freeze(Object.keys(ENTITY_KEYWORDS));

function buildCryptoClassifyBatchPrompt(titles) {
  if (!Array.isArray(titles) || titles.length === 0) {
    throw new TypeError('buildCryptoClassifyBatchPrompt requires a non-empty titles array');
  }
  for (let i = 0; i < titles.length; i += 1) {
    if (typeof titles[i] !== 'string' || !titles[i].trim()) {
      throw new TypeError(`titles[${i}] must be a non-empty string`);
    }
  }

  const system = [
    'You classify cryptocurrency news headlines for a trading bot that only trades BTC and ETH.',
    'Return ONLY a JSON array with one object per headline, in the same order as the input.',
    'No markdown, no commentary, no wrapper object.',
    'Each object must be exactly:',
    '{"entities":string[],"sentiment":number,"impact":number}',
    `entities: zero or more of ${ALLOWED_ENTITIES.join(', ')}.`,
    'BTC = Bitcoin-specific; ETH = Ethereum-specific; CRYPTO = broad crypto-market / exchange / regulatory risk affecting both.',
    'sentiment: number in [-1, 1] (negative = bearish for the named assets / risk-off for CRYPTO).',
    'impact: number in [0, 1]. Crypto news is usually an unscheduled shock, not a scheduled data print.',
    'Score impact by severity of the surprise: exchange hack/halt/insolvency ≈ 0.9–1.0;',
    'major ETF/regulatory structural decisions ≈ 0.8–0.95; lawsuits/enforcement/policy noise ≈ 0.4–0.7;',
    'price chatter / opinion without a concrete event ≈ 0–0.3.',
    'If a headline is irrelevant to BTC/ETH/crypto markets, return entities:[], sentiment:0, impact:0.',
  ].join(' ');

  const numbered = titles.map((t, i) => `${i + 1}. ${t.trim()}`).join('\n');
  const user = `Classify these ${titles.length} crypto headlines:\n${numbered}`;

  return { system, user };
}

function normalizeCryptoClassification(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new TypeError('classification item must be an object');
  }

  const rawEntities = Array.isArray(item.entities) ? item.entities : null;
  if (!rawEntities) {
    throw new TypeError('entities must be an array');
  }
  const entities = [];
  for (const e of rawEntities) {
    if (typeof e !== 'string') {
      throw new TypeError('entities entries must be strings');
    }
    const tag = e.trim().toUpperCase();
    if (!ALLOWED_ENTITIES.includes(tag)) {
      throw new RangeError(`unknown entity tag: ${e}`);
    }
    if (!entities.includes(tag)) entities.push(tag);
  }

  const sentiment = Number(item.sentiment);
  const impact = Number(item.impact);
  if (!Number.isFinite(sentiment) || sentiment < -1 || sentiment > 1) {
    throw new RangeError(`sentiment must be finite in [-1, 1], got ${item.sentiment}`);
  }
  if (!Number.isFinite(impact) || impact < 0 || impact > 1) {
    throw new RangeError(`impact must be finite in [0, 1], got ${item.impact}`);
  }

  return { entities, sentiment, impact };
}

function parseCryptoClassifyBatchResponse(text, expectedCount) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new TypeError('parseCryptoClassifyBatchResponse requires a non-empty string');
  }
  if (!Number.isInteger(expectedCount) || expectedCount < 1) {
    throw new RangeError('expectedCount must be a positive integer');
  }

  let raw = text.trim();
  const fence = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) raw = fence[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new SyntaxError(`invalid JSON classification response: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new TypeError('classification response must be a JSON array');
  }
  if (parsed.length !== expectedCount) {
    throw new RangeError(
      `expected ${expectedCount} classifications, got ${parsed.length}`
    );
  }
  return parsed.map((item) => normalizeCryptoClassification(item));
}

module.exports = {
  ALLOWED_ENTITIES,
  buildCryptoClassifyBatchPrompt,
  normalizeCryptoClassification,
  parseCryptoClassifyBatchResponse,
};
