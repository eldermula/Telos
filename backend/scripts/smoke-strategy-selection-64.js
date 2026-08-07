/**
 * Increment 6.4 smoke — Module 4 (Strategy Engine / Selection),
 * wired end-to-end: live `candidate_strategies` (migration 004) +
 * Module 2's per-instrument market intelligence (with its cached raw
 * bars) + Module 3's watchlist-wide news intelligence -> the pure
 * bot/strategy-engine selectTrade() (08_Bot_Architecture.md Section
 * 9.0/13). Requires MT5 connector + terminal, Postgres, and Redis to
 * be up. Real market conditions may or may not produce a live signal
 * this run — that's expected and handled below, not treated as a
 * failure (a no-trade tick is a legitimate Selection outcome).
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const { connectRedis, redis } = require('../src/db/redis');
const { pool } = require('../src/db/pool');
const candidateStrategiesRepository = require('../src/engine/candidate-strategies.repository');
const strategySelection = require('../src/engine/strategy-selection.service');
const mt5Connector = require('../src/services/mt5-connector.client');

const newsIntelligencePath = path.join(__dirname, '..', '..', 'bot', 'news-intelligence', 'src');
const { WATCHLIST } = require(path.join(newsIntelligencePath, 'watchlist.js'));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  await connectRedis();

  // 1. candidate_strategies (migration 004) — exactly the 3 approved
  // starter strategies, all live (status='active').
  const strategies = await candidateStrategiesRepository.listActiveStrategies();
  console.log('active_strategies', strategies.map((s) => s.name));
  assert(strategies.length === 3, `expected 3 active strategies, got ${strategies.length}`);
  const names = strategies.map((s) => s.name).sort();
  assert(
    JSON.stringify(names) === JSON.stringify(['Breakout', 'MA Crossover', 'RSI Mean Reversion']),
    `unexpected strategy set: ${names}`
  );
  for (const strategy of strategies) {
    assert(strategy.rule_set.signal?.type, `${strategy.name} rule_set missing signal.type`);
    assert(strategy.rule_set.base_confidence > 0, `${strategy.name} rule_set missing base_confidence`);
  }

  // 2. Full cross-instrument, cross-strategy selection against live
  // MT5 data for every watchlist instrument.
  const selection = await strategySelection.selectTradeAcrossWatchlist();
  console.log('selection', selection);

  if (selection === null) {
    console.log('no_trade_this_tick — legitimate outcome, nothing fired across the watchlist right now');
  } else {
    assert(WATCHLIST.includes(selection.chosen_instrument), `chosen_instrument not in watchlist: ${selection.chosen_instrument}`);
    assert(['BUY', 'SELL'].includes(selection.direction), `unexpected direction: ${selection.direction}`);
    assert(
      typeof selection.strategy_confidence === 'number' &&
        selection.strategy_confidence >= 0 &&
        selection.strategy_confidence <= 1,
      `strategy_confidence out of range: ${selection.strategy_confidence}`
    );
    assert(['MA Crossover', 'Breakout', 'RSI Mean Reversion'].includes(selection.strategy_name), `unexpected strategy_name: ${selection.strategy_name}`);

    // 3. Stop/target math against a real live price for the chosen instrument.
    const symbolInfo = await mt5Connector.getSymbolInfo(selection.chosen_instrument);
    const entryPrice = selection.direction === 'BUY' ? symbolInfo.ask : symbolInfo.bid;
    const { stopPrice, targetPrice, stopDistance } = strategySelection.computeSelectionStopTarget(selection, entryPrice);
    console.log('stop_target', { entryPrice, stopPrice, targetPrice, stopDistance });
    assert(stopDistance > 0, 'expected a positive stop distance');
    if (selection.direction === 'BUY') {
      assert(stopPrice < entryPrice, 'BUY stop should sit below entry');
      assert(targetPrice > entryPrice, 'BUY target should sit above entry');
    } else {
      assert(stopPrice > entryPrice, 'SELL stop should sit above entry');
      assert(targetPrice < entryPrice, 'SELL target should sit below entry');
    }
  }

  // 4. A strategy pool with nothing active produces a guaranteed no-trade tick.
  const originalList = candidateStrategiesRepository.listActiveStrategies;
  candidateStrategiesRepository.listActiveStrategies = async () => [];
  const emptyPoolSelection = await strategySelection.selectTradeAcrossWatchlist();
  candidateStrategiesRepository.listActiveStrategies = originalList;
  assert(emptyPoolSelection === null, 'expected null selection when no strategies are active');
  console.log('empty_pool_selection', emptyPoolSelection);

  await pool.end();
  redis.disconnect();

  console.log('STRATEGY_SELECTION_64_PASS');
}

main().catch(async (err) => {
  console.error('FAIL', err.message);
  try {
    await pool.end();
    redis.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
