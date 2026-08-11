# 14 — M5 Forex/Gold Paper Experiment — Telos

> **Status: PAPER-ONLY, experimental, not yet proven.** Real-dispatch enablement for M5 is a deliberate future decision that requires explicit human review of this experiment's results — this build does not unlock it, propose a timeline for it, or wire anything toward it.

**Built from:** the 2026-08-11 M5 probe (live connector data, M5 timeframe, 1000 bars/instrument across EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, XAUUSD), compared directly against an equivalent M15 probe run the same session. Runtime: `backend/src/engine/m5-paper-strategy.js` (pure math) + `backend/src/engine/m5-paper-harness.js` (I/O orchestration) + `POST/GET /api/v1/admin/experimental/m5-paper-*` + Admin UI "M5 paper (experimental)" tab — paper only, admin-only, in-memory.

---

## 1. Probe findings this build is based on

- **ATR ratio mechanism transfers cleanly M15→M5.** No changes needed to the Wilder ATR(14)/rolling-average-ratio calculation itself.
- **EMA gate** (`trend_quality_min 0.6`) **and Breakout gate** (`market_volatility_in ["HIGH"]`) **fire rates are comparable** between M5 and M15 — no recalibration needed for either.
- **RSI gate's per-100-bar fire rate is *lower* on M5 for 5 of 6 instruments**, despite the gate-open share staying similar (~40% on both timeframes). This is a real, measured difference — the build below reproduces observed M5 behavior as-is, it does not assume the M15 fire rate carries over.
- **Real M5 stop distances (1.5× ATR14 on M5):** EURUSD 0.0003016, GBPUSD 0.0004361, USDJPY 0.03790, AUDUSD 0.0002327, USDCAD 0.0004220, XAUUSD 6.340.
- **M5 minimum viable balance** (current bootstrap risk curve — 10% at $10, 30% at $50): EURUSD $3.02, GBPUSD $4.37, AUDUSD $2.33, USDCAD $4.23 (all four viable at $5) — **XAUUSD $30.96, USDJPY $126.35 are NOT viable at $5 or $10**, same as M15. These two must still correctly clamp-skip at low balances; this build's tests confirm they do (`m5-paper-strategy.test.js`).

---

## 2. Why this is a separate, isolated harness — not a `strategy_timeframe` flag on the live runtime

The obvious-looking approach — add a `strategy_timeframe: 'M15' | 'M5'` column to `bot_instances` and thread it through `bot-runtime.js`'s existing market-intelligence call — was considered and deliberately **not** taken, because `bot-runtime.js`'s tick dispatch resolves paper-vs-real *per tick*, from the account's own state (`account_type`, `live_trading_confirmed_at`, `REAL_TRADING_ENABLED`, the forex demo-dispatch bypass). A timeframe flag on that same runtime would feed whatever data it's configured for into `_maybeOpenPositionReal` too, the instant any of those real-dispatch conditions were ever satisfied — silently making M5 data reachable from a real order path. That would directly violate this experiment's hard boundary (M5 must never be able to reach real dispatch, structurally, not just by default-off configuration).

Instead, M5 paper trading lives in two new modules with **zero import overlap** with the real-dispatch path:

- **`backend/src/engine/m5-paper-strategy.js`** — pure math (no I/O). Evaluates one tick's watchlist using the same building blocks the live engine uses (`evaluateMarketIntelligence`, `selectTrade`, `computeStopTarget` from `bot/strategy-engine`), then sizes the simulated trade using the same `dollar_risk / (stop_distance × contract_size)` → `clampLotSize` mechanics real dispatch would use (unlike `bot-runtime.js`'s *standard* forex paper mode, which uses a placeholder `lotSize = appliedRisk * 0.1` that's never clamp-skipped — this experiment specifically needs the real clamp-skip behavior to measure it, so it reuses `synthetic-lot-clamp.js`'s `computeSyntheticRawLotSize`/`clampLotSize` instead). It never imports `real-lot-sizing.js`, `bot-runtime.js`, `REAL_TRADING_ENABLED`, confirm-live, or any admin real-dispatch service.
- **`backend/src/engine/m5-paper-harness.js`** — I/O orchestration. Its only MT5 connector calls are `getRates`, `getSymbolInfo`, and `getAccountInfo` — all read-only GETs. It never imports `placeOrder`/`closeOrder`, `bot-runtime.js`, or `trading-engine.js`. There is no code path in either file that reaches the connector's `/order/*` endpoints — this cannot place a real order even in principle, not just "won't because a flag says paper."

The harness is a **global, admin-controlled singleton** (mirrors the existing `forex_demo_dispatch_config` singleton pattern, not `bot_instances`'s per-user rows) with **in-memory-only** state — no new database tables, no `bot_instances` schema change, no relation to any user's real forex/synthetics session. History resets on a backend restart; that's intentional for an explicitly experimental, unproven tool, not an oversight. This also means the live forex/synthetics sessions and the `bot_instances` schema are untouched by this build — nothing here needed a migration.

---

## 3. What it does, one tick at a time

1. Read-only `getAccountInfo()` for live equity — used only to make the simulated position size realistic, no order ever placed against this balance.
2. Read-only `getRates(symbol, { timeframe: 'M5', count: 100 })` + `getSymbolInfo(symbol)` for every watchlist instrument.
3. Same gate mechanism as the live engine: `evaluateMarketIntelligence` → `selectTrade` against the DB's active `candidate_strategies` (same EMA/Breakout/RSI rule sets, same one-candidate-system-wide design).
4. If a strategy fires: compute stop/target via `computeStopTarget` (1.5× ATR stop, 2:1 reward:risk — unchanged), size the simulated lot via `computeSyntheticRawLotSize` + `clampLotSize`. If it clamp-skips (XAUUSD/USDJPY at low balances), that's logged as a decision, no simulated trade opens.
5. If it opens, the harness tracks it in memory and closes it once a later tick's live bid/ask crosses the simulated stop or target — never touching the broker.
6. One simulated position at a time, same one-position-system-wide design as the live engine.

---

## 4. Admin UI

`/admin` → **"M5 paper (experimental)"** tab — a separate tab from "Demo dispatch", clearly labeled, with red warning copy. Start/Stop buttons, live status, open position, recent closed trades, and a decision log (including every `skipped_below_volume_min` and `no_signal`/data-error event). **Not reachable from the Trading page or any real-trading flow at all** — the Trading page's Start Trading control is untouched and stays M15-only.

---

## 5. Test coverage

- `backend/src/engine/m5-paper-strategy.test.js` — stop-distance math reproduces the probe's real M5 ATR-derived numbers exactly; clamp-skip behavior matches the probe's $5/$10 findings for all six instruments (XAUUSD/USDJPY skip, the other four don't); `computeAppliedRisk` matches the bootstrap curve; full `evaluateM5Tick` integration (opens, skips, no-signal, insufficient-data) against deterministic synthetic M5 bars.
- `backend/src/engine/m5-paper-harness.test.js` — lifecycle (start/stop idempotency), open/monitor/close flow against a fake connector, one-position-at-a-time enforcement, graceful handling of an account-info failure. The fake connector deliberately does not implement `placeOrder`/`closeOrder` at all, so the tests would fail immediately if the harness ever tried to call either.
- Confirmed via `node --test`: all M15 forex/synthetics tests are unaffected (this build adds two new files and touches only `admin.controller.js`/`admin.service.js`/`admin.routes.js` — nothing in `bot-runtime.js`, `trading-engine.js`, or `bot_instances`).

---

## 6. What this build explicitly does NOT do

- Does not enable, wire, or prepare real dispatch for M5 in any way.
- Does not change `REAL_TRADING_ENABLED`, the confirm-live flow, or any admin real-dispatch toggle.
- Does not touch the live forex or synthetics runtimes, `bot_instances`, or any migration.
- Does not claim M5 is viable or ready for real trading — that determination, and any decision to build a real M5 dispatch path, is left to a future session after a human reviews this experiment's live results.
