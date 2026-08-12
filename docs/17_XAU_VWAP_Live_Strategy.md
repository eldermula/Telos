# XAUUSD VWAP p90 — Controlled Real-Money Strategy

**Status:** CONTROLLED REAL-MONEY VALIDATION (not a production guarantee)  
**Scope:** XAUUSD · M5 · only  
**Doc companion:** `docs/16_XAU_VWAP_Paper_Experiment.md` (paper predecessor)

> Historical / paper numbers (e.g. costed backtest n=16, WR 43.8%, E[R]=+0.31) are
> **not** a guarantee of live profitability. They are validation context only and are
> **not** hardcoded into execution logic. Live orders use live market data, live
> spread, live equity, and the platform’s existing risk calculator.

## 1. Purpose

Move the validated XAUUSD M5 VWAP p90 stretch-reversion candidate from paper
observation into a **controlled real-money** path that:

- generates a trade **intent** only inside the strategy module;
- submits orders **only** through the existing approved real-dispatch /
  `mt5-connector` `placeOrder` / position-monitor path;
- fails closed on missing data, risk, broker health, or kill-switch conditions.

## 2. Signal definition

- **Instrument:** XAUUSD only  
- **Timeframe:** M5 only  
- **VWAP:** rolling intraday VWAP from live bars (typical price × tick volume),
  reset each UTC day — same methodology as the paper module / probe.  
- **p90:** empirical 90th percentile of `|close − VWAP|` on the current bar
  window — recomputed every evaluation; **never** a hardcoded historical
  threshold.  
- **Entry:** same-day cross where `|close−VWAP|` moves from below p90 to at/above
  p90; trade **toward** VWAP (stretch above → SELL, stretch below → BUY).  
- **Stop:** `max(1.5 × ATR14, 2.0 × current live spread)`  
- **Target:** 2R (reward-to-risk = 2)

## 3. Live-dispatch architecture

| Layer | Control | Independent of |
| --- | --- | --- |
| 0 | Broker account-info + `expectedAccountType` on `placeOrder` | — |
| 1 | `XAU_VWAP_LIVE_TRADING_ENABLED=true` (env kill switch, default off) | forex / synthetic / M5 flags |
| 2 | `bot_instances.xau_vwap_live_trading_confirmed_at` + phrase confirm | forex / synthetic / M5 confirms |
| 2b | `xau_vwap_demo_dispatch_config.confirm_enabled_until` | other demo-confirm tables |
| 3 | `xau_vwap_demo_dispatch_config.enabled_until` | other demo-dispatch tables |

Plus: `halt_new_opens` (emergency stop), `one_open_trade_per_user`, `REAL_MAX_LOT`,
stale connection / equity / spread / ATR / VWAP / p90 / market-data freshness
checks.

**Modules:**

- `xau-vwap-live-strategy.js` — intent math + fail-closed guards  
- `xau-vwap-live-dispatch.js` — `attemptOpen` / `attemptMonitor` via connector  
- `xau-vwap-live-harness.js` — admin singleton tick loop  
- `xau-vwap-demo-dispatch.service.js` — Layer 2b/3  
- Migration `027` (`asset_class=xau_vwap_live`) + `028` (confirm column +
  `xau_vwap_demo_dispatch_config`)

Asset class tag: **`xau_vwap_live`**. Open positions share the system-wide one-open
constraint with forex/crypto/synthetic/M5.

## 4. Authorization & admin controls

Admin-only routes under `/api/v1/admin/experimental/xau-vwap-live-*`.  
Admin UI tab: **“XAUUSD VWAP p90 — LIVE (REAL MONEY)”** — not on Trading page,
not exposed to ordinary users.

Confirm-live uses the same deliberate phrase as other real strategies; session
must be stopped to confirm; confirm clears on Stop. Enable/disable events write
`admin_audit_log`.

## 5. Risk

Lot size uses the existing bootstrap / tier ceiling risk calculator and
`computeSyntheticRawLotSize` + `clampLotSize`, then `REAL_MAX_LOT`. The strategy
**cannot** auto-increase risk based on performance.

## 6. Logging / audit

`bot_decision_log` records `real_order_placed` / `real_order_closed` /
`real_order_failed` with strategy id, VWAP/p90/spread/ATR-stop fields, lot,
ticket, slippage, PnL, realized R. Historical rows are never overwritten.
Config enable/disable is audited.

## 7. Failure behavior (fail closed)

Do **not** trade if: strategy disabled, env kill switch off, confirm inactive,
demo bypass required but off, emergency stop on, broker unhealthy/stale,
equity invalid, spread/ATR/VWAP/p90 unavailable, market data stale, account risk
unverifiable, or duplicate open exists.

## 8. Rollback / disable

1. Stop session (Admin UI or `POST .../xau-vwap-live-stop`) — clears confirm.  
2. Disable Layer 2b/3 demo bypasses if used.  
3. Set `XAU_VWAP_LIVE_TRADING_ENABLED` unset/`false` and restart backend.  
4. Verify UI status **DISABLED**.

## 9. Monitoring

Watch Admin LIVE tab: uiStatus, emergency stop, broker status, last signal /
order, open position, decision log, and connector health. After any live test,
leave the strategy **DISABLED** unless an explicit admin re-enable is intended.
