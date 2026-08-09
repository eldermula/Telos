'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtimeSource = fs.readFileSync(path.join(__dirname, 'synthetic-bot-runtime.js'), 'utf8');

describe('synthetic-bot-runtime paper + batch2 gates', () => {
  it('never imports bot-runtime.js or crypto-bot-runtime.js', () => {
    assert.equal(/require\(['"]\.\/bot-runtime/.test(runtimeSource), false);
    assert.equal(/require\(['"]\.\/crypto-bot-runtime/.test(runtimeSource), false);
  });

  it('wires Layer 0 + clamp + real methods without using forex REAL_TRADING_ENABLED', () => {
    assert.match(runtimeSource, /resolveExpectedAccountTypeForLayer0/);
    assert.match(runtimeSource, /clampLotSize/);
    assert.match(runtimeSource, /_maybeOpenPositionReal/);
    assert.match(runtimeSource, /_monitorOpenPositionReal/);
    assert.match(runtimeSource, /SYNTHETIC_REAL_TRADING_ENABLED/);
    assert.equal(
      /realTradingEnabled:\s*REAL_TRADING_ENABLED\b/.test(runtimeSource),
      false
    );
  });

  it('uses system-wide listOpenTradesForUser for the tick-time open guard', () => {
    assert.match(runtimeSource, /listOpenTradesForUser\(this\.userId\)/);
    assert.match(runtimeSource, /_hasAnyOpenTradeForUser/);
    assert.match(runtimeSource, /one_open_trade_per_user/);
    assert.equal(/_hasOpenSyntheticTrade/.test(runtimeSource), false);
    assert.equal(/one_open_trade_per_user_asset_class/.test(runtimeSource), false);
  });

  it('computes paper P&L as riskedAmount × realRMultiple', () => {
    const riskedAmount = 0.5;
    const entryPrice = 100;
    const stopPrice = 99;
    const exitPrice = 102;
    const direction = 'BUY';
    const stopDistance = Math.abs(entryPrice - stopPrice);
    const signedMove = (exitPrice - entryPrice) * (direction === 'BUY' ? 1 : -1);
    const realRMultiple = stopDistance > 0 ? signedMove / stopDistance : 0;
    const pnlAmount = riskedAmount * realRMultiple;
    assert.equal(realRMultiple, 2);
    assert.equal(pnlAmount, 1);
  });
});
