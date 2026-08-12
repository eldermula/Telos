'use strict';
/**
 * Hard 5-minute wall-clock M1 PAPER-ONLY run.
 * Stops at 5 minutes regardless of trade count. Read-only connector only.
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
const MAX_WALL_MS = 5 * 60 * 1000;
const OUT = path.join(__dirname, '..', 'backend', '_m1-paper-run-results.json');

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
  const openedCount = (status.decisionLog || []).filter((d) => d.type === 'opened').length;
  const flooredOpens = (status.decisionLog || []).filter(
    (d) => d.type === 'opened' && d.flooredBySpread
  ).length;
  const holdSecs = closed
    .filter((t) => t.openedAt && t.closedAt)
    .map((t) => (new Date(t.closedAt) - new Date(t.openedAt)) / 1000);
  const survivedPastOneTick = holdSecs.filter((s) => s > TICK_MS / 1000 + 1).length;
  const immediateStopouts = holdSecs.filter((s) => s <= TICK_MS / 1000 + 1).length;

  return {
    writtenAt: new Date().toISOString(),
    stopReason,
    elapsedMs: Date.now() - startedMs,
    maxWallMs: MAX_WALL_MS,
    tickCount: status.tickCount,
    openTrade: status.openTrade,
    openedCount,
    closedCount: closed.length,
    wins,
    losses,
    totalPnl: pnl,
    avgHoldSeconds: holdSecs.length
      ? holdSecs.reduce((a, b) => a + b, 0) / holdSecs.length
      : null,
    minHoldSeconds: holdSecs.length ? Math.min(...holdSecs) : null,
    maxHoldSeconds: holdSecs.length ? Math.max(...holdSecs) : null,
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`M1 paper 5-MINUTE wall-clock run: tickMs=${TICK_MS} — PAPER ONLY`);
  const harness = createM1PaperHarness({
    mt5Connector,
    candidateStrategiesRepository,
    tickMs: TICK_MS,
  });
  const startedMs = Date.now();
  let stopReason = 'wall_clock_5m';

  while (Date.now() - startedMs < MAX_WALL_MS) {
    await harness.tick();
    const after = harness.getStatus();
    const elapsedMin = ((Date.now() - startedMs) / 60000).toFixed(2);
    const closed = after.closedTrades.length;
    const opened = (after.decisionLog || []).filter((d) => d.type === 'opened').length;
    const wins = after.closedTrades.filter((t) => t.outcome === 'target_hit').length;
    const losses = after.closedTrades.filter((t) => t.outcome === 'stop_hit').length;
    console.log(
      `[${elapsedMin}m tick ${after.tickCount}] opened=${opened} closed=${closed} W/L=${wins}/${losses} ` +
        `open=${after.openTrade ? after.openTrade.symbol + ' ' + after.openTrade.direction : 'none'} ` +
        `err=${after.lastTickError || 'none'}`
    );
    fs.writeFileSync(OUT, JSON.stringify(summarize(after, null, startedMs), null, 2));

    const remaining = MAX_WALL_MS - (Date.now() - startedMs);
    if (remaining <= 0) break;
    await sleep(Math.min(TICK_MS, remaining));
  }

  harness.stop();
  const final = summarize(harness.getStatus(), stopReason, startedMs);
  final.startedAt = new Date(startedMs).toISOString();
  final.stoppedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(final, null, 2));
  console.log('STOP:', stopReason);
  console.log(
    `FINAL: ticks=${final.tickCount} opened=${final.openedCount} closed=${final.closedCount} ` +
      `W/L=${final.wins}/${final.losses} survivedPastOneTick=${final.survivedPastOneTick} ` +
      `immediateStopouts=${final.immediateStopouts}`
  );
  console.log('Results:', OUT);
  setTimeout(() => process.exit(0), 500);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
