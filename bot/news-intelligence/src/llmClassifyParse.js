'use strict';

/**
 * Module 3 — pure LLM classification helpers (no network).
 * Real Claude client / kill-switch wiring is a later step; this module
 * only builds the batch prompt and validates/parses the JSON shape
 * downstream already consumes: { entities, sentiment, impact }.
 */

const { CURRENCY_KEYWORDS } = require('./stubClassifier');

const ALLOWED_ENTITIES = Object.freeze(Object.keys(CURRENCY_KEYWORDS));

/**
 * @param {string[]} titles
 * @returns {{ system: string, user: string }}
 */
function buildClassifyBatchPrompt(titles) {
  if (!Array.isArray(titles) || titles.length === 0) {
    throw new TypeError('buildClassifyBatchPrompt requires a non-empty titles array');
  }
  for (let i = 0; i < titles.length; i += 1) {
    if (typeof titles[i] !== 'string' || !titles[i].trim()) {
      throw new TypeError(`titles[${i}] must be a non-empty string`);
    }
  }

  const system = [
    'You classify forex/macro news headlines for a trading bot.',
    'Return ONLY a JSON array with one object per headline, in the same order as the input.',
    'No markdown, no commentary, no wrapper object.',
    'Each object must be exactly:',
    '{"entities":string[],"sentiment":number,"impact":number}',
    `entities: zero or more of ${ALLOWED_ENTITIES.join(', ')} (currency tags; XAU = gold/safe-haven).`,
    "sentiment: number in [-1, 1] (negative = bearish for named entities currencies / risk-off for XAU as appropriate).",
    'impact: number in [0, 1] (0 = noise, 1 = market-moving).',
    'If a headline is irrelevant, return entities:[], sentiment:0, impact:0.',
  ].join(' ');

  const numbered = titles.map((t, i) => `${i + 1}. ${t.trim()}`).join('\n');
  const user = `Classify these ${titles.length} headlines:\n${numbered}`;

  return { system, user };
}

/**
 * @param {unknown} item
 * @returns {{ entities: string[], sentiment: number, impact: number }}
 */
function normalizeClassification(item) {
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

/**
 * Strip optional ```json fences, then parse + normalize an array of
 * classifications. Length must match expectedCount.
 *
 * @param {string} text
 * @param {number} expectedCount
 * @returns {{ entities: string[], sentiment: number, impact: number }[]}
 */
function parseClassifyBatchResponse(text, expectedCount) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new TypeError('parseClassifyBatchResponse requires a non-empty string');
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
    throw new SyntaxError(`LLM classification JSON parse failed: ${err.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new TypeError('LLM classification response must be a JSON array');
  }
  if (parsed.length !== expectedCount) {
    throw new RangeError(
      `expected ${expectedCount} classifications, got ${parsed.length}`
    );
  }

  return parsed.map((item, i) => {
    try {
      return normalizeClassification(item);
    } catch (err) {
      throw new TypeError(`classifications[${i}]: ${err.message}`);
    }
  });
}

module.exports = {
  ALLOWED_ENTITIES,
  buildClassifyBatchPrompt,
  normalizeClassification,
  parseClassifyBatchResponse,
};