'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseRssItems } = require('./rss-parser');

const MULTI_ITEM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title><![CDATA[US July non-farm payrolls -23K vs +80K expected]]></title>
      <link>https://example.com/nfp</link>
      <pubDate>Fri, 07 Aug 2026 12:30:24 GMT</pubDate>
      <guid>https://example.com/nfp</guid>
    </item>
    <item>
      <title><![CDATA[EUR/GBP consolidates ahead of ECB]]></title>
      <link>https://example.com/eurgbp</link>
      <pubDate>Fri, 07 Aug 2026 11:00:00 GMT</pubDate>
      <guid>https://example.com/eurgbp</guid>
    </item>
  </channel>
</rss>`;

const SINGLE_ITEM_FEED = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Only headline</title>
      <link>https://example.com/only</link>
    </item>
  </channel>
</rss>`;

test('parses a multi-item RSS feed into flat headline objects', () => {
  const items = parseRssItems(MULTI_ITEM_FEED);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'US July non-farm payrolls -23K vs +80K expected');
  assert.equal(items[0].link, 'https://example.com/nfp');
  assert.equal(items[0].guid, 'https://example.com/nfp');
  assert.equal(items[1].title, 'EUR/GBP consolidates ahead of ECB');
});

test('a single-item feed is not left un-arrayed (fast-xml-parser quirk)', () => {
  const items = parseRssItems(SINGLE_ITEM_FEED);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Only headline');
  // guid falls back to link when the feed omits an explicit <guid>.
  assert.equal(items[0].guid, 'https://example.com/only');
  assert.equal(items[0].pubDate, null);
});

test('rejects empty input rather than silently returning nothing useful', () => {
  assert.throws(() => parseRssItems(''), /non-empty/);
  assert.throws(() => parseRssItems('   '), /non-empty/);
});

test('rejects a non-RSS document instead of returning a misleading empty list', () => {
  assert.throws(() => parseRssItems('<html><body>not rss</body></html>'), /rss\.channel/);
});

test('filters out any item with no title (nothing useful to classify)', () => {
  const feedWithBlank = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Test</title>
  <item><title></title><link>https://example.com/blank</link></item>
  <item><title>Real headline</title><link>https://example.com/real</link></item>
</channel></rss>`;
  const items = parseRssItems(feedWithBlank);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Real headline');
});
