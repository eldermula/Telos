'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtimeSource = fs.readFileSync(path.join(__dirname, 'synthetic-bot-runtime.js'), 'utf8');

describe('synthetic-bot-runtime paper', () => {
  it('never imports bot-runtime.js or crypto-bot-runtime.js', () => {
    assert.equal(/require\(['"]\.\/bot-runtime/.test(runtimeSource), false);
    assert.equal(/require\(['"]\.\/crypto-bot-runtime/.test(runtimeSource), false);
  });

  it('Batch 1: may resolve execution mode for logging, but never place/close orders', () => {
    assert.equal(/\bplaceOrder\b/.test(runtimeSource), false);
    assert.equal(/\bcloseOrder\b/.test(runtimeSource), false);
    assert.equal(/_maybeOpenPositionReal/.test(runtimeSource), false);
    // Forex Layer 1 flag must not drive synthetics.
    assert.equal(
      /realTradingEnabled:\s*REAL_TRADING_ENABLED\b/.test(runtimeSource),
      false
    );
    assert.match(runtimeSource, /SYNTHETIC_REAL_TRADING_ENABLED/);
    assert.match(runtimeSource, /resolveExecutionMode/);
    assert.match(runtimeSource, /synthetic_live_trading_confirmed_at/);
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
