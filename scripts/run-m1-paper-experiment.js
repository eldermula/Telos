'use strict';
/**
 * Standalone M1 PAPER-ONLY extended run.
 * Uses createM1PaperHarness against the live connector (read-only only).
 * Does NOT start the backend admin singleton, does NOT touch real dispatch,
 * does NOT call placeOrder/closeOrder.
 *
 * Writes periodic snapshots to backend/_m1-paper-run-results.json.
 * Duration: M1_PAPER_RUN_HOURS env (default 3), tick every 15s.
 */
const path = require('path');
require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', 'backend', '.env'),
});
const fs = require('fs');
const mt5Connector = require('../backend/src/services/mt5-connector.client');
const candidateStrategiesRepository = require('../backend/src/engine/candidate-strategies.repository');
const { createM1PaperHarness } = require('../backend/src/engine/m1-paper-harness');

const HOURS = Number(process.env.M1_PAPER_RUN_HOURS) || 3;
const TICK_MS = Number(process.env.M1_PAPER_TICK_MS) || 15000;
const OUT = path.join(__dirname, '..', 'backend', '_m1-paper-run-results.json');
const DURATION_MS = HOURS * 60 * 60 * 1000;

function summarize(status) {
  const closed = status.closedTrades || [];
  const wins = closed.filter((t) => t.outcome === 'target_hit');
  const losses = closed.filter((t) => t.outcome === 'stop_hit');
  const pnl = closed.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const bySymbol = {};
  for (const t of closed) {
    bySymbol[t.symbol] = bySymbol[t.symbol] || { n: 0, pnl: 0, wins: 0, losses: 0 };
    bySymbol[t.symbol].n += 1;
    bySymbol[t.symbol].pnl += Number(t.pnl) || 0;
    if (t.outcome === 'target_hit') bySymbol[t.symbol].wins += 1;
    if (t.outcome === 'stop_hit') bySymbol[t.symbol].losses += 1;
  }
  const decisionTypes = {};
  for (const d of status.decisionLog || []) {
    decisionTypes[d.type] = (decisionTypes[d.type] || 0) + 1;
  }
  return {
    writtenAt: new Date().toISOString(),
    status: status.status,
    startedAt: status.startedAt,
    tickCount: status.tickCount,
    openTrade: status.openTrade,
    closedCount: closed.length,
    wins: wins.length,
    losses: losses.length,
    totalPnl: pnl,
    bySymbol,
    decisionTypesSample: decisionTypes,
    lastTickError: status.lastTickError,
    closedTrades: closed,
    decisionLog: status.decisionLog,
  };
}

async function main() {
  console.log(`M1 paper run starting: ${HOURS}h, tick ${TICK_MS}ms — PAPER ONLY`);
  const harness = createM1PaperHarness({
    mt5Connector,
    candidateStrategiesRepository,
    tickMs: TICK_MS,
  });

  const writeSnapshot = () => {
    const snap = summarize(harness.getStatus());
    fs.writeFileSync(OUT, JSON.stringify(snap, null, 2));
    console.log(
      `[${snap.writtenAt}] ticks=${snap.tickCount} closed=${snap.closedCount} ` +
        `W/L=${snap.wins}/${snap.losses} pnl=${snap.totalPnl.toFixed(2)} ` +
        `open=${snap.openTrade ? snap.openTrade.symbol : 'none'}`
    );
  };

  harness.start();
  writeSnapshot();

  const started = Date.now();
  const snapshotTimer = setInterval(writeSnapshot, 5 * 60 * 1000);
  if (typeof snapshotTimer.unref === 'function') snapshotTimer.unref();

  await new Promise((resolve) => {
    const endTimer = setTimeout(resolve, DURATION_MS);
    // Keep process alive for duration.
    endTimer.ref();
  });

  clearInterval(snapshotTimer);
  harness.stop();
  writeSnapshot();
  console.log('M1 paper run complete. Results:', OUT);
  // Allow pool/redis to settle; force exit so we don't hang on open handles.
  setTimeout(() => process.exit(0), 2000);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
