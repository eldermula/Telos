'use strict';
/**
 * Recalculate M1 min-viable balances with spread-aware stops.
 * Uses live mean spreads + live M1 1.5×ATR from _spread-probe-out.json/txt,
 * plus original probe ATRs for a second column (docs comparison).
 * Read-only math — no connector calls.
 */
const path = require('path');
const fs = require('fs');

const { computeAppliedRisk, SPREAD_STOP_MULTIPLE, resolveM1StopDistance } =
  require('../backend/src/engine/m1-paper-strategy');
const { computeSyntheticRawLotSize, clampLotSize } =
  require('../backend/src/engine/synthetic-lot-clamp');

// PowerShell `>` redirect wrote UTF-16 LE; decode accordingly.
const probeRaw = fs.readFileSync(path.join(__dirname, '../backend/_spread-probe-out.txt'));
const probeOut =
  probeRaw[0] === 0xff && probeRaw[1] === 0xfe
    ? probeRaw.toString('utf16le')
    : probeRaw.toString('utf8');
const jsonStart = probeOut.indexOf('{');
const jsonEnd = probeOut.lastIndexOf('}');
const probe = JSON.parse(probeOut.slice(jsonStart, jsonEnd + 1));

const OLD_MIN = {
  EURUSD: 0.34,
  GBPUSD: 0.41,
  USDJPY: 21.32,
  AUDUSD: 0.4,
  USDCAD: 0.27,
  XAUUSD: 6.64,
};

const OLD_ATR_STOP = {
  EURUSD: 0.00006612,
  GBPUSD: 0.00008173,
  USDJPY: 0.00667279,
  AUDUSD: 0.00007936,
  USDCAD: 0.00005385,
  XAUUSD: 1.32788,
};

function findMinViable(stopDistance, contractSize, volumeMin, entryPrice) {
  const symbolInfo = { volume_min: volumeMin, volume_step: 0.01, volume_max: 100 };
  // Binary search on balance in [0.01, 500]
  let lo = 0.01;
  let hi = 500;
  let found = null;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const appliedRisk = computeAppliedRisk(mid);
    const raw = computeSyntheticRawLotSize({
      effectiveBalance: mid,
      appliedRisk,
      entryPrice,
      stopPrice: entryPrice - stopDistance,
      contractSize,
    });
    const clamp = clampLotSize(raw.rawLotSize, symbolInfo);
    if (!clamp.skipped) {
      found = mid;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return found;
}

console.log(`SPREAD_STOP_MULTIPLE = ${SPREAD_STOP_MULTIPLE}`);
console.log(
  'symbol | spread_mean | atr_stop_live | spread_floor | new_stop | old_min$ | new_min$ | delta$ | at$5 | at$10'
);

const results = [];
for (const row of probe.rows) {
  const spreadMean = row.spread.mean;
  const atrStop = row.m1_stop_1_5atr;
  const floor = SPREAD_STOP_MULTIPLE * spreadMean;
  const newStop = Math.max(atrStop, floor);
  const entry = row.ask || 1;
  const minV = findMinViable(newStop, row.contract_size, row.volume_min, entry);
  const old = OLD_MIN[row.symbol];

  const checkAt = (bal) => {
    const appliedRisk = computeAppliedRisk(bal);
    const raw = computeSyntheticRawLotSize({
      effectiveBalance: bal,
      appliedRisk,
      entryPrice: entry,
      stopPrice: entry - newStop,
      contractSize: row.contract_size,
    });
    return clampLotSize(raw.rawLotSize, {
      volume_min: row.volume_min,
      volume_step: 0.01,
      volume_max: 100,
    }).skipped
      ? 'SKIP'
      : 'ok';
  };

  // Also verify resolveM1StopDistance with synthetic symbolInfo
  const resolved = resolveM1StopDistance({
    currentATR: atrStop / 1.5,
    stopRule: { multiple: 1.5 },
    symbolInfo: { bid: row.bid, ask: row.ask },
  });

  const line = {
    symbol: row.symbol,
    spreadMean,
    atrStopLive: atrStop,
    atrStopOldProbe: OLD_ATR_STOP[row.symbol],
    spreadFloor: floor,
    newStop,
    flooredBySpread: newStop > atrStop + 1e-15,
    oldMin: old,
    newMin: minV != null ? Number(minV.toFixed(2)) : null,
    delta: minV != null ? Number((minV - old).toFixed(2)) : null,
    at5: checkAt(5),
    at10: checkAt(10),
    resolveCheck: resolved.stopDistance,
  };
  results.push(line);
  console.log(
    `${row.symbol} | ${spreadMean.toFixed(6)} | ${atrStop.toFixed(6)} | ${floor.toFixed(6)} | ${newStop.toFixed(6)} | $${old} | $${line.newMin} | +$${line.delta} | ${line.at5} | ${line.at10}`
  );
}

// M5 safety summary from same probe (read-only report)
console.log('\n=== M5 READ-ONLY (no code change) ===');
for (const row of probe.rows) {
  console.log(
    `${row.symbol}: M5_stop=${row.m5_stop_1_5atr.toFixed(6)} meanSp=${row.spread.mean.toFixed(6)} ` +
      `ratio=${row.m5_stop_over_mean_spread.toFixed(2)} inside_mean=${row.m5_inside_mean_spread} inside_max=${row.m5_inside_max_spread}`
  );
}

fs.writeFileSync(
  path.join(__dirname, '../backend/_m1-minviable-recalc.json'),
  JSON.stringify({ SPREAD_STOP_MULTIPLE, results }, null, 2)
);
console.log('\nWrote backend/_m1-minviable-recalc.json');
