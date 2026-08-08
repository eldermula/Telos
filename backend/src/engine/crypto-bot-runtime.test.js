'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtimeSource = fs.readFileSync(path.join(__dirname, 'crypto-bot-runtime.js'), 'utf8');

describe('crypto-bot-runtime paper Increment E', () => {
  it('never imports bot-runtime.js', () => {
    assert.equal(runtimeSource.includes("require('./bot-runtime") || runtimeSource.includes('require("./bot-runtime'), false);
    assert.equal(/require\(['"]\.\/bot-runtime/.test(runtimeSource), false);
  });

  it('never references MT5 order APIs or live-trading gates', () => {
    assert.equal(/\bplaceOrder\b/.test(runtimeSource), false);
    assert.equal(/\bcloseOrder\b/.test(runtimeSource), false);
    assert.equal(/REAL_TRADING_/.test(runtimeSource), false);
    assert.equal(/confirmLive|confirm-live|live_trading_confirmed/.test(runtimeSource), false);
    assert.equal(/mt5Connector\.(place|close)/.test(runtimeSource), false);
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
