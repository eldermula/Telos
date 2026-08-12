'use strict';
/**
 * Judgment-based M1 PAPER-ONLY run (no hard tick/trade cap).
 * Stops when the sample is sufficient for honest conclusions:
 *   - >= 12 closed trades spanning >= 2 symbols, OR
 *   - >= 20 closed trades (any mix), OR
 *   - 2 hours elapsed with >= 6 closed trades, OR
 *   - 2.5 hours elapsed regardless (report whatever exists)
 * Read-only connector only. Never placeOrder/closeOrder.
 */
const path = require('path');
require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', 'backend', '.env'),
});
const fs = require('fs');
const mt5Connector = require('../backend/src/services/mt5-connector.client');
const candidateStrategiesRepository = require('../backend/src/engine/candidate-strategies.repository');
const { createM1PaperHarness } = require('../backend/src/engine/m1-paper-harness');

const TICK_MS = Number(process.env.M1_PAPER_TICK_MS) || 15000;
const OUT = path.join(__dirname, '..', 'backend', '_m1-paper-run-results.json');
const OUT_ARCHIVE = path.join(
  __dirname,
  '..',
  'backend',
  `_m1-paper-run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
);
const HARD_CEILING_MS = 2.5 * 60 * 60 * 1000;
const SOFT_ENOUGH_MS = 2 * 60 * 60 * 1000;

function summarize(status, stopReason, startedMs) {
  const closed = status.closedTrades || [];
  const wins = closed.filter((t) => t.outcome === 'target_hit').length;
  const losses = closed.filter((t) => t.outcome === 'stop_hit').length;
  const pnl = closed.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const bySymbol = {};
  const byStrategy = {};
  for (const t of closed) {
    bySymbol[t.symbol] = bySymbol[t.symbol] || { n: 0, pnl: 0, wins: 0, losses: 0 };
    bySymbol[t.symbol].n += 1;
    bySymbol[t.symbol].pnl += Number(t.pnl) || 0;
    if (t.outcome === 'target_hit') bySymbol[t.symbol].wins += 1;
    if (t.outcome === 'stop_hit') bySymbol[t.symbol].losses += 1;
    byStrategy[t.strategyName] = (byStrategy[t.strategyName] || 0) + 1;
  }
  const decisionTypes = {};
  for (const d of status.decisionLog || []) {
    decisionTypes[d.type] = (decisionTypes[d.type] || 0) + 1;
  }
  // Hold times for closed trades (Session A failure mode = ~one 15s tick)
  const holdSecs = closed
    .filter((t) => t.openedAt && t.closedAt)
    .map((t) => (new Date(t.closedAt) - new Date(t.openedAt)) / 1000);
  const avgHold =
    holdSecs.length > 0 ? holdSecs.reduce((a, b) => a + b, 0) / holdSecs.length : null;
  const minHold = holdSecs.length > 0 ? Math.min(...holdSecs) : null;
  const maxHold = holdSecs.length > 0 ? Math.max(...holdSecs) : null;
  const survivedPastOneTick = holdSecs.filter((s) => s > TICK_MS / 1000 + 1).length;
  const immediateStopouts = holdSecs.filter((s) => s <= TICK_MS / 1000 + 1).length;
  const flooredOpens = (status.decisionLog || []).filter(
    (d) => d.type === 'opened' && d.flooredBySpread
  ).length;

  return {
    writtenAt: new Date().toISOString(),
    stopReason,
    elapsedMs: Date.now() - startedMs,
    status: status.status,
    startedAt: status.startedAt,
    stoppedAt: status.stoppedAt,
    tickCount: status.tickCount,
    openTrade: status.openTrade,
    closedCount: closed.length,
    wins,
    losses,
    totalPnl: pnl,
    avgHoldSeconds: avgHold,
    minHoldSeconds: minHold,
    maxHoldSeconds: maxHold,
    holdSeconds: holdSecs,
    survivedPastOneTick,
    immediateStopouts,
    flooredOpens,
    bySymbol,
    byStrategy,
    decisionTypesSample: decisionTypes,
    lastTickError: status.lastTickError,
    closedTrades: closed,
    decisionLog: status.decisionLog,
  };
}

function enough(status, elapsedMs) {
  const closed = status.closedTrades || [];
  const symbols = new Set(closed.map((t) => t.symbol));
  if (closed.length >= 12 && symbols.size >= 2) {
    return `sufficient_sample (${closed.length} closed across ${symbols.size} symbols)`;
  }
  if (closed.length >= 20) {
    return `sufficient_sample (${closed.length} closed trades)`;
  }
  if (elapsedMs >= SOFT_ENOUGH_MS && closed.length >= 6) {
    return `time_and_sample (${(elapsedMs / 3600000).toFixed(2)}h, ${closed.length} closed)`;
  }
  if (elapsedMs >= HARD_CEILING_MS) {
    return `hard_ceiling_2_5h (${closed.length} closed — report with what exists)`;
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(
    `M1 paper JUDGMENT run: tickMs=${TICK_MS}, stop when sample is sufficient (max 2.5h) — PAPER ONLY`
  );
  console.log(`Archive path: ${OUT_ARCHIVE}`);
  const harness = createM1PaperHarness({
    mt5Connector,
    candidateStrategiesRepository,
    tickMs: TICK_MS,
  });
  const startedMs = Date.now();
  let stopReason = null;
  const printedCloses = new Set();

  while (true) {
    await harness.tick();
    // Mark startedAt for status readability (tick-only path never sets it)
    const after = harness.getStatus();
    if (!after.startedAt) {
      // getStatus doesn't expose setters; synthesize in summarize via startedMs
    }
    const closed = after.closedTrades.length;
    const wins = after.closedTrades.filter((t) => t.outcome === 'target_hit').length;
    const losses = after.closedTrades.filter((t) => t.outcome === 'stop_hit').length;
    const elapsedMin = ((Date.now() - startedMs) / 60000).toFixed(1);
    console.log(
      `[${elapsedMin}m tick ${after.tickCount}] closed=${closed} W/L=${wins}/${losses} ` +
        `open=${after.openTrade ? after.openTrade.symbol + ' ' + after.openTrade.direction : 'none'} ` +
        `err=${after.lastTickError || 'none'}`
    );
    const snap = summarize(after, null, startedMs);
    fs.writeFileSync(OUT, JSON.stringify(snap, null, 2));
    // Also keep a run-specific archive so a later short run cannot clobber history.
    fs.writeFileSync(OUT_ARCHIVE, JSON.stringify(snap, null, 2));

    // Loud per-close line so entry/exit/pnl survive even if JSON is later overwritten.
    if (closed > 0) {
      const last = after.closedTrades[after.closedTrades.length - 1];
      if (last && last.closedAt && !printedCloses.has(last.closedAt)) {
        printedCloses.add(last.closedAt);
        console.log(
          `CLOSE ${last.symbol} ${last.direction} ${last.strategyName} ${last.outcome} ` +
            `entry=${last.entryPrice} exit=${last.closePrice} stopDist=${last.stopDistance} ` +
            `floored=${last.flooredBySpread} pnl=${last.pnl} ` +
            `holdSec=${((new Date(last.closedAt) - new Date(last.openedAt)) / 1000).toFixed(1)}`
        );
      }
    }

    stopReason = enough(after, Date.now() - startedMs);
    if (stopReason) break;
    await sleep(TICK_MS);
  }

  harness.stop();
  const final = summarize(harness.getStatus(), stopReason, startedMs);
  final.startedAt = new Date(startedMs).toISOString();
  final.stoppedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(final, null, 2));
  fs.writeFileSync(OUT_ARCHIVE, JSON.stringify(final, null, 2));
  console.log('STOP:', stopReason);
  console.log(
    `FINAL: ticks=${final.tickCount} closed=${final.closedCount} W/L=${final.wins}/${final.losses} pnl=${final.totalPnl.toFixed(4)}`
  );
  console.log('Results:', OUT);
  console.log('Archive:', OUT_ARCHIVE);
  setTimeout(() => process.exit(0), 1500);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
