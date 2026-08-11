# 14 — M5 Forex/Gold Paper + Real-Dispatch Experiment — Telos

> **Status: EXPERIMENTAL, UNPROVEN LIVE.** The paper harness (§1-6 below) is measurement-only and has never placed a real order — that part remains proven-safe by construction. A **real-dispatch pathway now exists** (§7) that CAN place real MT5 orders once an admin explicitly arms it, but **it has never been run against a live account** — no session has been started, no confirm-live call has been made, and no order has been placed via this pathway as of the build described in §7. A human-reviewed live proof (mirroring forex's Vol 10 / `docs/11` E.8 first-real-trade proof) is the required next step before this is trusted for anything beyond deliberate, supervised testing.

**Built from:** the 2026-08-11 M5 probe (live connector data, M5 timeframe, 1000 bars/instrument across EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, XAUUSD), compared directly against an equivalent M15 probe run the same session. Paper runtime: `backend/src/engine/m5-paper-strategy.js` (pure math) + `backend/src/engine/m5-paper-harness.js` (I/O orchestration) + `POST/GET /api/v1/admin/experimental/m5-paper-*` + Admin UI "M5 paper (experimental)" tab — paper only, admin-only, in-memory. Real-dispatch runtime (§7): `backend/src/engine/m5-real-dispatch.js` + `backend/src/engine/m5-real-harness.js` + `POST/GET /api/v1/admin/experimental/m5-real-*` + the same Admin UI tab, in a clearly separated "M5 real-dispatch (UNPROVEN LIVE)" section.

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

## 6. What the paper build (§1-5) explicitly does NOT do

- Does not enable, wire, or prepare real dispatch for M5 in any way. (§7 below is a **separate, later build** that does — read that section's scope carefully before assuming anything here changed.)
- Does not change `REAL_TRADING_ENABLED`, the M15 forex confirm-live flow, or any of forex/synthetics' own admin real-dispatch toggles.
- Does not touch the live forex or synthetics runtimes, `bot_instances`'s pre-existing columns, or any pre-§7 migration.
- Does not claim M5 is viable or ready for real trading on its own — that determination remains a human call (§8).

---

## 7. M5 real-dispatch (UNPROVEN LIVE) — built, never run live

A second, later build extended the M5 module family with a real-dispatch equivalent, **mirroring the M15 forex real-dispatch pattern (`bot-runtime.js` `_maybeOpenPositionReal`/`_monitorOpenPositionReal`) file-for-file** rather than inventing a new safety model. This section documents that build. **As of this writing, no session has been started, no confirm-live call has been made, and no order has been placed through this pathway — it exists only as code + tests.**

### 7.1 Why a new module family, not a flag on `m5-paper-harness.js`

Same reasoning as §2 above, one level deeper: `m5-paper-harness.js` is structurally incapable of placing a real order (no `placeOrder`/`closeOrder` import, ever). Adding a "real mode" flag to it would break that invariant. Instead, real-dispatch is two **new, separate** files:

- **`backend/src/engine/m5-real-dispatch.js`** — `attemptOpen`/`attemptMonitor`. Reuses `m5-paper-strategy.js`'s `evaluateM5Tick` (the same probe-validated stop-distance math and `clampLotSize` safety net proven in §1/§5) for signal generation and sizing, but calls the connector's real `placeOrder`/`closeOrder` and uses **broker-authoritative close detection** (ticket disappearing from `getPositions()`, reconciled via `getOrderHistory`) instead of comparing live price to a locally-tracked stop/target the way `m5-paper-harness.js`'s `evaluateM5Monitor` does.
- **`backend/src/engine/m5-real-harness.js`** — the admin-operated tick-loop singleton, one real M5 session at a time, tied to the operating admin's own `bot_instances` row (same `ensureForUser` reuse as forex/crypto/synthetics — that admin needs their own linked broker connection).

Deliberately **not** reusing `bot-runtime.js`'s full APIRS tier/drawdown state machine (`evaluateEntry`/`resolveExit`, tier progression, daily-drawdown circuit breakers) — M5 real-dispatch reuses the same **stateless** bootstrap-risk math already proven in the paper build (`computeAppliedRisk` from live equity, recomputed fresh every tick). The point of this build is proving the real-order mechanism works end-to-end on the M5 data path, not standing up a second tier-progression engine.

### 7.2 Layered safety — same shape as M15 forex, independent state

| Layer | M15 forex | M5 real-dispatch (this build) |
|---|---|---|
| 0 — account verification | `resolveExpectedAccountTypeForLayer0` + retry-wrapped account-info pre-check (400ms, one retry, read-only, never around `placeOrder`) | **Same function, same retry pattern**, reused directly (`execution-mode.js`) |
| 1 — kill switch | `REAL_TRADING_ENABLED` | **New, independent:** `M5_REAL_TRADING_ENABLED` (exact-string `'true'` only; default off everywhere including production) |
| 2 — confirm-live | `bot_instances.live_trading_confirmed_at`, `live-trading-confirmation.js` | **New, independent column:** `bot_instances.m5_live_trading_confirmed_at` (migration `026`), same `live-trading-confirmation.js` module (already asset-class-agnostic) and confirmation phrase, new route `POST /admin/experimental/m5-real-confirm-live` |
| 2b/3 — demo bypasses | `forex_demo_dispatch_config` | **New, independent table:** `m5_demo_dispatch_config` (migration `026`) — `confirm_enabled_until` (Layer 2b) + `enabled_until` (Layer 3), same 30-minute-max admin-JWT-gated auto-expiring pattern as `forex-demo-dispatch.service.js`/`synthetic-demo-dispatch.service.js`, implemented in the new `m5-demo-dispatch.service.js` |
| — | one_open_trade_per_user | **Same system-wide constraint** — M5 real trades are tagged `asset_class='m5_forex_gold'` (migration `025`, new enum value) in the same `trades` table, so an open M5 real position blocks a forex/crypto/synthetic open for that admin and vice versa, enforced both by the DB unique index and in `m5-real-dispatch.js`'s `attemptOpen` |

Confirming M5 live trading does **not** confirm or affect forex's own `live_trading_confirmed_at`, and vice versa — proven directly in `m5-real-harness.test.js` ("starts when a real account is confirmed, independent of forex live_trading_confirmed_at"). All four gate layers are **re-verified every tick**, not just at Start — mirrors `bot-runtime.js`'s `_resolveTickContext`. If any layer degrades mid-session (confirm-live TTL lapses, a demo bypass is disabled, the env kill switch flips), the session halts to `status='error'` rather than silently falling back to paper — there is no paper fallback inside this module by design; paper trading only ever lives in `m5-paper-harness.js`.

### 7.3 Admin UI

`/admin` → "M5 paper (experimental)" tab, in a clearly separated **"M5 real-dispatch (UNPROVEN LIVE)"** section below the paper controls: Layer 1 status (read-only — env var, not togglable from the UI), Layer 2 confirm-live phrase input, Layer 2b/Layer 3 demo-bypass toggles (own 1-30 minute inputs, own enable/disable buttons), session Start/Stop, open real position, recent closed real trades, and a real-dispatch decision log. Still not reachable from the Trading page or any real-trading flow — same isolation principle as the paper section above it.

### 7.4 Known limitation, flagged not silently half-built

No resume-after-backend-restart for an open real M5 position (`bot-runtime.js` has this for forex via `_resumeRealOpenTrade`; this harness does not). If the backend restarts while a real M5 position is open, the broker-side stop/target still protects it, but `m5-real-harness.js` will no longer track/monitor/close it automatically — a human must check MT5 directly. Acceptable for a testing-only tool that a human starts and watches; would need to be fixed before any broader use.

### 7.5 Test coverage

- `backend/src/engine/m5-real-dispatch.test.js` — Layer 0 retry (succeeds after one retry / halts after both fail, mirrors `bot-runtime.js`'s pattern exactly), stale-connection and invalid-equity halts, system-wide one-open-trade block (non-halting), clamp-skip at $5/$10 for XAUUSD/USDJPY reproducing the same probe numbers as the paper build, successful open (records trade with `assetClass='m5_forex_gold'`, logs, notifies), `placeOrder` failure halts, and broker-authoritative monitor/close (still-open no-op, history reconciliation + close, history-unavailable halt, transient `getPositions` error retries next tick without inventing a close).
- `backend/src/engine/m5-real-harness.test.js` — start() preconditions (missing operator, Layer 1 off, Layer 2 not armed, Layer 3 demo gating, independence from forex's own confirm-live), tick-driven open/monitor/close, mid-session gate degradation halting the session, Layer 0 failure halting on tick, and Stop clearing `m5_live_trading_confirmed_at` independently of forex's column.
- Confirmed via `node --test`: all M15 forex/synthetics/crypto tests and the §1-6 paper-build tests are unaffected — this build only adds new files (`m5-real-dispatch.js`, `m5-real-harness.js`, `m5-demo-dispatch.service.js`, migrations `025`/`026`) plus additive changes to `env.js`, `bot-instance.repository.js`, `admin.service.js`, `admin.controller.js`, `admin.routes.js`.

### 7.6 What this build explicitly does NOT do

- Does not place any real order, start any session, or call confirm-live against any live account. Every test above runs against fully mocked dependencies — no network, no DB, no MT5 connector calls anywhere in either test file.
- Does not enable `REAL_TRADING_ENABLED`, `M5_REAL_TRADING_ENABLED`, or any demo-dispatch toggle in any real environment as part of this build. `M5_REAL_TRADING_ENABLED` defaults to off everywhere, same strictness as `REAL_TRADING_ENABLED`.
- Does not touch `bot-runtime.js`, `synthetic-bot-runtime.js`, `crypto-bot-runtime.js`, or the M15 forex/synthetics confirm-live and demo-dispatch state.
- Does not constitute a live proof. See §8.

---

## 8. What's left before this is trusted

A human-reviewed live proof — the same discipline forex went through (`docs/11`'s E.8 first-real-trade increment) and synthetics went through (Vol 10 live demo roundtrip) — is the required next step before M5 real-dispatch is trusted for anything beyond deliberate, supervised admin testing:

1. A human deliberately enables `M5_REAL_TRADING_ENABLED` in a non-production environment (or a demo-account test with the Layer 3 bypass), confirms live trading via the Admin UI, and starts a session while watching it directly.
2. At least one full open→monitor→close cycle is observed end-to-end against a real connector/broker, with the resulting `trades`/`bot_decision_log` rows and notification inspected by a human.
3. Any surprises (timing, sizing, broker-specific quirks) are captured back into this document before any further scope (e.g. non-admin access, automatic starts, production enablement) is even discussed.

Until that happens, treat §7 as "code exists and is unit-tested," not "proven to work against a real broker."
