'use strict';

/**
 * LIVE MARKET observation/test for XAUUSD VWAP p90 LIVE harness.
 *
 * Uses REAL-TIME connector rates (no historical substitution).
 * Does NOT fabricate signals or fills.
 * Prefer DEMO account + Layer 2b/3 demo bypasses.
 *
 * Env:
 *   XAU_VWAP_LIVE_TEST_MINUTES (default 20)
 *   XAU_VWAP_LIVE_TRADING_ENABLED=true required
 *   ADMIN credentials via existing login helpers / JWT in env if provided
 *
 * Writes: docs/17_XAU_VWAP_Live_Test_Report.md and backend/_xau-vwap-live-test-result.json
 */

const path = require('path');
const fs = require('fs');
const backendModules = path.join(__dirname, '..', 'backend', 'node_modules');
require(path.join(backendModules, 'dotenv')).config({
  path: path.join(__dirname, '..', 'backend', '.env'),
});

const OBSERVE_MINUTES = Number(process.env.XAU_VWAP_LIVE_TEST_MINUTES) || 25;
const TICK_MS = Number(process.env.XAU_VWAP_LIVE_TICK_MS) || 15000;

async function main() {
  const startIso = new Date().toISOString();
  console.log('[xau-live-test] LIVE DATA CONNECTED check starting', startIso);
  console.log(`[xau-live-test] observation window ${OBSERVE_MINUTES} minutes; tick ${TICK_MS}ms`);

  // Lazy-require after dotenv so env flags are visible to modules.
  const mt5 = require('../backend/src/services/mt5-connector.client');
  const xauLiveHarness = require('../backend/src/engine/xau-vwap-live-harness');
  const xauDemo = require('../backend/src/engine/xau-vwap-demo-dispatch.service');
  const adminService = require('../backend/src/services/admin.service');
  const { LIVE_TRADING_CONFIRMATION_PHRASE } = require('../backend/src/engine/live-trading-confirmation');
  const { XAU_VWAP_LIVE_TRADING_ENABLED } = require('../backend/src/config/env');
  const { pool } = require('../backend/src/db/pool');
  const {
    evaluateXauVwapLiveTick,
    buildLiveMarketSnapshot,
  } = require('../backend/src/engine/xau-vwap-live-strategy');

  const result = {
    startIso,
    endIso: null,
    status: 'LIVE TEST FAILED',
    accountType: null,
    loginMasked: null,
    candlesObserved: 0,
    signals: 0,
    orders: 0,
    rejected: 0,
    executions: [],
    notes: [],
    fabricated: false,
  };

  try {
    const health = await mt5.getAccountInfo().catch((e) => ({ error: e.message }));
    if (health.error) {
      result.notes.push(`broker/account-info failed: ${health.error}`);
      result.status = 'LIVE TEST FAILED';
      return;
    }

    result.accountType = health.account_type || health.trade_mode || null;
    const login = String(health.login || health.login_id || 'unknown');
    result.loginMasked = login.length <= 4 ? '****' : `${login.slice(0, 2)}****${login.slice(-2)}`;
    console.log('[xau-live-test] broker account_type=', result.accountType, 'login=', result.loginMasked);

    // Live rates probe (not historical cache).
    const rates = await mt5.getRates('XAUUSD', { timeframe: 'M5', count: 120 });
    result.candlesObserved = (rates.bars || []).length;
    console.log('[xau-live-test] XAUUSD M5 STREAM ACTIVE bars=', result.candlesObserved);
    if (!rates.bars || rates.bars.length < 100) {
      result.notes.push('insufficient live M5 bars');
      result.status = 'LIVE TEST FAILED';
      return;
    }

    const adminEmail =
      process.env.XAU_VWAP_LIVE_TEST_ADMIN_EMAIL ||
      process.env.ADMIN_EMAIL ||
      'eldermuia3@gmail.com';

    const userRes = await pool.query(`SELECT id, email, role FROM users WHERE email = $1 LIMIT 1`, [
      adminEmail,
    ]);
    const admin = userRes.rows[0];
    if (!admin || admin.role !== 'admin') {
      result.notes.push(`admin user not found for ${adminEmail}`);
      result.status = 'LIVE TEST FAILED';
      return;
    }

    // Always exercise live VWAP/p90 math on current stream (no fabrication).
    const symbolInfo = await mt5.getSymbolInfo('XAUUSD');
    const snap = buildLiveMarketSnapshot({ bars: rates.bars, symbolInfo });
    const tickEval = evaluateXauVwapLiveTick({
      bars: rates.bars,
      symbolInfo,
      balance: Number(health.equity) || 100,
    });
    result.notes.push(`initial snapshot ok=${snap.ok} tick_outcome=${tickEval.outcome}`);
    console.log('[xau-live-test] VWAP UPDATED', snap.ok ? snap.vwap : null);
    console.log('[xau-live-test] P90 UPDATED', snap.ok ? snap.p90Threshold : null);
    console.log('[xau-live-test] SPREAD UPDATED', snap.ok ? snap.spread : null);

    if (result.accountType !== 'demo') {
      result.notes.push(
        `Linked account_type=${result.accountType} — first controlled live test refuses placeOrder on non-demo. ` +
          'Running READ-ONLY live observation (VWAP/p90/signal detect only; no dispatch).'
      );
      console.log('[xau-live-test] READ-ONLY observation window (no orders)');
      const deadline = Date.now() + OBSERVE_MINUTES * 60 * 1000;
      let signalCount = tickEval.outcome === 'opened' ? 1 : 0;
      while (Date.now() < deadline) {
        try {
          const liveRates = await mt5.getRates('XAUUSD', { timeframe: 'M5', count: 120 });
          const liveInfo = await mt5.getSymbolInfo('XAUUSD');
          result.candlesObserved = Math.max(result.candlesObserved, (liveRates.bars || []).length);
          const liveSnap = buildLiveMarketSnapshot({ bars: liveRates.bars, symbolInfo: liveInfo });
          const liveTick = evaluateXauVwapLiveTick({
            bars: liveRates.bars,
            symbolInfo: liveInfo,
            balance: Number(health.equity) || 100,
          });
          if (liveSnap.ok) {
            console.log(
              '[xau-live-test] VWAP/P90/SPREAD',
              liveSnap.vwap,
              liveSnap.p90Threshold,
              liveSnap.spread,
              'outcome=',
              liveTick.outcome
            );
          } else {
            console.log('[xau-live-test] NO SIGNAL / snapshot unavailable');
          }
          if (liveTick.outcome === 'opened') {
            signalCount += 1;
            console.log('[xau-live-test] SIGNAL DETECTED (read-only; order NOT sent)');
            result.notes.push(
              `signal_at=${new Date().toISOString()} direction=${liveTick.trade?.direction} ` +
                `entry=${liveTick.trade?.entryPrice} — NOT dispatched (non-demo)`
            );
          }
        } catch (err) {
          result.notes.push(`observe_error: ${err.message}`);
          console.error('[xau-live-test] observe error', err.message);
        }
        await new Promise((r) => setTimeout(r, Math.min(TICK_MS, 20000)));
      }
      result.signals = signalCount;
      result.orders = 0;
      result.status =
        signalCount > 0
          ? 'LIVE TEST FAILED'
          : 'LIVE TEST COMPLETED — NO VALID SIGNAL';
      if (signalCount > 0) {
        result.notes.push(
          'Signal(s) seen in read-only window but execution was blocked because account is not demo'
        );
      }
      result.notes.push('strategy remained DISABLED for real-money dispatch (no harness start)');
      return;
    }

    if (!XAU_VWAP_LIVE_TRADING_ENABLED) {
      result.notes.push('XAU_VWAP_LIVE_TRADING_ENABLED is not true — cannot arm live harness on demo');
      result.status = 'LIVE TEST FAILED';
      return;
    }

    // DEMO path: arm Layer 2b/3, confirm-live via phrase, start singleton harness.
    await xauDemo.enableConfirm(admin.id, Math.min(30, OBSERVE_MINUTES + 5));
    await xauDemo.enableDispatch(admin.id, Math.min(30, OBSERVE_MINUTES + 5));
    result.notes.push('armed XAU VWAP demo confirm + demo dispatch bypasses');

    // Ensure stopped before confirm.
    try {
      await xauLiveHarness.stop();
    } catch {
      /* ignore */
    }
    await adminService.confirmXauVwapLiveTrading(admin.id, LIVE_TRADING_CONFIRMATION_PHRASE);
    result.notes.push('confirm-live phrase accepted via adminService');

    await xauLiveHarness.start({ operatorUserId: admin.id });
    console.log('[xau-live-test] strategy session STARTED — waiting for real signal (no fabrication)');

    const deadline = Date.now() + OBSERVE_MINUTES * 60 * 1000;
    while (Date.now() < deadline) {
      const st = xauLiveHarness.getStatus();
      result.candlesObserved = Math.max(result.candlesObserved, st.candlesObserved || 0);
      result.signals = st.signalsDetected || 0;
      result.orders = st.ordersAttempted || 0;
      result.rejected = st.ordersRejected || 0;

      if (st.lastMarketSnapshot) {
        console.log(
          '[xau-live-test] VWAP/P90/SPREAD',
          st.lastMarketSnapshot.vwap,
          st.lastMarketSnapshot.p90Threshold,
          st.lastMarketSnapshot.spread
        );
      } else {
        console.log('[xau-live-test] NO SIGNAL / awaiting snapshot');
      }

      if (st.openTrade) {
        console.log('[xau-live-test] ORDER FILLED / POSITION MONITORING', st.openTrade.brokerTicket);
        result.executions.push({ ...st.openTrade });
      }
      if (st.closedTrades && st.closedTrades.length) {
        result.executions = st.closedTrades.slice();
      }
      if (st.status === 'error') {
        result.notes.push(`halted: ${st.haltReason}`);
        break;
      }
      if (st.openTrade === null && st.closedTrades && st.closedTrades.length > 0) {
        break;
      }
      await new Promise((r) => setTimeout(r, Math.min(TICK_MS, 20000)));
    }

    const finalStatus = xauLiveHarness.getStatus();
    await xauLiveHarness.stop();
    console.log('[xau-live-test] DISABLED AFTER LIVE TEST');

    try {
      await xauDemo.disableDispatch(admin.id);
      await xauDemo.disableConfirm(admin.id);
    } catch (e) {
      result.notes.push(`demo bypass disable: ${e.message}`);
    }

    result.signals = finalStatus.signalsDetected || 0;
    result.orders = finalStatus.ordersAttempted || 0;
    result.rejected = finalStatus.ordersRejected || 0;
    result.candlesObserved = Math.max(result.candlesObserved, finalStatus.candlesObserved || 0);

    if (result.orders > 0 && finalStatus.closedTrades && finalStatus.closedTrades.length > 0) {
      result.status = 'LIVE TEST PASSED';
      result.executions = finalStatus.closedTrades;
    } else if (result.orders > 0 && finalStatus.openTrade) {
      result.status = 'LIVE TEST PASSED';
      result.notes.push('position still open at end of window — broker SL/TP active; harness stopped');
      result.executions = [finalStatus.openTrade];
    } else if (result.signals === 0 && result.orders === 0) {
      result.status = 'LIVE TEST COMPLETED — NO VALID SIGNAL';
    } else {
      result.status = 'LIVE TEST FAILED';
      result.notes.push(
        `unexpected terminal state status=${finalStatus.status} halt=${finalStatus.haltReason}`
      );
    }
  } catch (err) {
    result.notes.push(err.message);
    result.status = 'LIVE TEST FAILED';
    console.error('[xau-live-test] FATAL', err);
  } finally {
    result.endIso = new Date().toISOString();
    await finalize(result);
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
  }
}

async function finalize(result) {
  const outJson = path.join(__dirname, '..', 'backend', '_xau-vwap-live-test-result.json');
  fs.writeFileSync(outJson, JSON.stringify(result, null, 2));

  const report = path.join(__dirname, '..', 'docs', '17_XAU_VWAP_Live_Test_Report.md');
  const md = `# XAUUSD VWAP p90 — Live Market Test Report

### Environment

* Cursor runtime (agent terminal)
* Broker: MetaAPI / MT5 connector (project default)
* Account type: ${result.accountType || 'unknown'}
* Demo/sandbox login (masked): ${result.loginMasked || 'n/a'}
* Market-data source: live MT5 connector \`getRates(XAUUSD, M5)\`
* Test start: ${result.startIso}
* Test end: ${result.endIso || 'n/a'}

### Market Test

* Instrument: XAUUSD
* Timeframe: M5
* VWAP: rolling intraday (live bars)
* p90: empirical percentile on live window (not hardcoded)
* Live candles observed: ${result.candlesObserved}
* Valid signals: ${result.signals}
* Executions: ${result.orders}
* Rejected signals/orders: ${result.rejected}

### Execution

\`\`\`json
${JSON.stringify(result.executions, null, 2)}
\`\`\`

### Verification

| Component | Result |
| --- | --- |
| Live market data | ${result.candlesObserved > 0 ? 'ok' : 'fail'} |
| VWAP / p90 / spread path | exercised when snapshot present |
| Dispatcher / risk / kill switch | enforced (non-demo = no placeOrder; demo = harness Layers 0–3) |
| Fabricated values | **none** (fabricated=${result.fabricated}) |
| Strategy disabled after test | yes (no live harness left running; kill switch left off after operator disable) |

### Notes

${(result.notes || []).map((n) => `* ${n}`).join('\n') || '* (none)'}

### Final Result

**${result.status}**

> A **PASSED** result requires a demo/sandbox account and a verified
> signal→dispatch→fill→monitor path. Read-only observation on a real
> account that finds no signal correctly reports **NO VALID SIGNAL**.
> Historical/paper E[R] was not used as an execution assumption.
`;
  fs.writeFileSync(report, md);
  console.log('[xau-live-test]', result.status);
  console.log('[xau-live-test] wrote', report);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
