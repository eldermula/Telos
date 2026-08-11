'use strict';
/**
 * Bounded M1 PAPER-ONLY run — SCOPE CAP:
 *   stop at 300 ticks OR 15 closed paper trades, whichever first.
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

const MAX_TICKS = Number(process.env.M1_PAPER_MAX_TICKS) || 300;
const MAX_CLOSED = Number(process.env.M1_PAPER_MAX_CLOSED) || 15;
const TICK_MS = Number(process.env.M1_PAPER_TICK_MS) || 15000;
const OUT = path.join(__dirname, '..', 'backend', '_m1-paper-run-results.json');

function summarize(status, stopReason) {
  const closed = status.closedTrades || [];
  // closedTrades is capped at 20 in getStatus — also use decisionLog opened/stop/target counts
  const wins = closed.filter((t) => t.outcome === 'target_hit').length;
  const losses = closed.filter((t) => t.outcome === 'stop_hit').length;
  const pnl = closed.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const bySymbol = {};
  for (const t of closed) {
    bySymbol[t.symbol] = bySymbol[t.symbol] || { n: 0, pnl: 0, wins: 0, losses: 0, strategies: {} };
    bySymbol[t.symbol].n += 1;
    bySymbol[t.symbol].pnl += Number(t.pnl) || 0;
    if (t.outcome === 'target_hit') bySymbol[t.symbol].wins += 1;
    if (t.outcome === 'stop_hit') bySymbol[t.symbol].losses += 1;
    bySymbol[t.symbol].strategies[t.strategyName] =
      (bySymbol[t.symbol].strategies[t.strategyName] || 0) + 1;
  }
  const decisionTypes = {};
  for (const d of status.decisionLog || []) {
    decisionTypes[d.type] = (decisionTypes[d.type] || 0) + 1;
  }
  return {
    writtenAt: new Date().toISOString(),
    stopReason,
    status: status.status,
    startedAt: status.startedAt,
    stoppedAt: status.stoppedAt,
    tickCount: status.tickCount,
    maxTicks: MAX_TICKS,
    maxClosed: MAX_CLOSED,
    openTrade: status.openTrade,
    closedCount: closed.length,
    wins,
    losses,
    totalPnl: pnl,
    bySymbol,
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
  console.log(
    `M1 paper BOUNDED run: maxTicks=${MAX_TICKS}, maxClosed=${MAX_CLOSED}, tickMs=${TICK_MS} — PAPER ONLY`
  );
  const harness = createM1PaperHarness({
    mt5Connector,
    candidateStrategiesRepository,
    tickMs: TICK_MS,
  });

  let stopReason = null;
  while (true) {
    await harness.tick();
    const after = harness.getStatus();
    const closedAfter = (after.closedTrades || []).length;
    const wins = after.closedTrades.filter((t) => t.outcome === 'target_hit').length;
    const losses = after.closedTrades.filter((t) => t.outcome === 'stop_hit').length;
    console.log(
      `[tick ${after.tickCount}] closed=${closedAfter} W/L=${wins}/${losses} ` +
        `open=${after.openTrade ? after.openTrade.symbol + ' ' + after.openTrade.direction : 'none'} ` +
        `err=${after.lastTickError || 'none'}`
    );
    fs.writeFileSync(OUT, JSON.stringify(summarize(after, null), null, 2));

    if (after.tickCount >= MAX_TICKS) {
      stopReason = `max_ticks_reached (${MAX_TICKS})`;
      break;
    }
    if (closedAfter >= MAX_CLOSED) {
      stopReason = `max_closed_trades_reached (${MAX_CLOSED})`;
      break;
    }
    await sleep(TICK_MS);
  }

  harness.stop();
  const final = summarize(harness.getStatus(), stopReason);
  fs.writeFileSync(OUT, JSON.stringify(final, null, 2));
  console.log('STOP:', stopReason);
  console.log(
    `FINAL: ticks=${final.tickCount} closed=${final.closedCount} W/L=${final.wins}/${final.losses} pnl=${final.totalPnl.toFixed(4)}`
  );
  console.log('Results:', OUT);
  setTimeout(() => process.exit(0), 1500);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
