'use strict';

const { XMLParser } = require('fast-xml-parser');

// Lives in backend, not bot/news-intelligence, specifically because it
// needs `fast-xml-parser` — bot/apirs and bot/market-intelligence both
// deliberately stay dependency-free, and this is the one piece of
// Module 3 that genuinely needs a real XML parser rather than hand-rolled
// regex parsing of arbitrary feed HTML/entities. Still a pure function
// (XML text in, headline objects out) — no network call in here.

const parser = new XMLParser({ ignoreAttributes: true, trimValues: true });

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  // fast-xml-parser can return a nested object for mixed content (rare
  // for title/link/pubDate/guid in practice) — stringify rather than
  // crash on a feed shape this module didn't anticipate.
  return String(value);
}

/**
 * Parses an RSS 2.0 feed (08_Bot_Architecture.md Section 9.3's free
 * headline sources) into a flat list of `{title, link, pubDate, guid}`.
 * Tolerant of a single-item channel — `fast-xml-parser` doesn't wrap a
 * lone `<item>` in an array — and of missing optional fields.
 */
function parseRssItems(xmlText) {
  if (typeof xmlText !== 'string' || !xmlText.trim()) {
    throw new Error('parseRssItems requires a non-empty XML string');
  }

  const parsed = parser.parse(xmlText);
  const channel = parsed && parsed.rss && parsed.rss.channel;
  if (!channel) {
    throw new Error('parseRssItems: not a recognizable RSS 2.0 feed (missing rss.channel)');
  }

  return toArray(channel.item)
    .map((item) => ({
      title: textOf(item.title).trim(),
      link: textOf(item.link).trim(),
      pubDate: textOf(item.pubDate).trim() || null,
      guid: (textOf(item.guid) || textOf(item.link)).trim(),
    }))
    .filter((item) => item.title.length > 0);
}

module.exports = { parseRssItems };
