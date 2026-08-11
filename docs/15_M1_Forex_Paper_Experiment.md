# 15 — M1 Forex/Gold Paper Experiment

**Status:** PAPER-ONLY, experimental, not yet proven.  
**Built:** 2026-08-11/12 from a live M1 probe (1000 bars/instrument).  
**Hard boundary:** this experiment must never place a real order. There is no M1 real-dispatch module, no `M1_REAL_TRADING_ENABLED`, and no confirm-live route for M1. Enabling real dispatch for M1 is a separate, human-supervised future decision — not something this build unlocks.

## 1. Probe findings this build is based on

Live connector data, M1 timeframe, 1000 bars/instrument across EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, XAUUSD (~15 wall-clock hours of M1 bars in the eval window).

### Stop distances (1.5× ATR14 on M1)

| Symbol | ATR14 | Stop (1.5×) | Min viable balance | At $5 | At $10 |
|---|---|---|---|---|---|
| EURUSD | 0.00004408 | 0.00006612 | $0.34 | ok | ok |
| GBPUSD | 0.00005449 | 0.00008173 | $0.41 | ok | ok |
| USDJPY | 0.00444853 | 0.00667279 | $21.32 | SKIP | SKIP |
| AUDUSD | 0.00005291 | 0.00007936 | $0.40 | ok | ok |
| USDCAD | 0.00003590 | 0.00005385 | $0.27 | ok | ok |
| XAUUSD | 0.88525252 | 1.32787878 | $6.64 | SKIP | ok |

Compared to M5: stops are much tighter (roughly 4–5× smaller), so more instruments clear `volume_min` at low balances. Notably XAUUSD becomes viable at $10 on M1 (it was not on M5). USDJPY still correctly clamp-skips at $5/$10.

### Gate-open share (M15-tuned thresholds, unchanged)

RSI gate (~35–48% open) and EMA gate (~16–28% open) look broadly similar to M5. Breakout HIGH-vol gate stays rare (~2–4%).

### Fire rates (gate-qualified) — do not assume “5× candles = 5× signals”

| Symbol | EMA /100 | BO /100 | RSI /100 | EMA /hr | BO /hr | RSI /hr |
|---|---|---|---|---|---|---|
| EURUSD | 0.22 | 0.78 | 1.00 | 0.13 | 0.47 | 0.60 |
| GBPUSD | 0.11 | 0.55 | 0.89 | 0.07 | 0.33 | 0.53 |
| USDJPY | 0.22 | 0.55 | 0.33 | 0.13 | 0.33 | 0.20 |
| AUDUSD | 0.11 | 0.44 | 0.33 | 0.07 | 0.27 | 0.20 |
| USDCAD | 0.00 | 0.78 | 0.89 | 0.00 | 0.47 | 0.53 |
| XAUUSD | 0.00 | 0.55 | 0.22 | 0.00 | 0.33 | 0.13 |

Per-100-bar RSI fire rates on M1 are **lower** than the M15 baseline (2–4 /100). Wall-clock fires/hour are modest (~0.1–0.6). M1 is noisier and closes 5× more often than M5, but that does **not** translate into 5× more gate-qualified entries.

## 2. Why a separate harness (not a timeframe flag on the live runtime)

Same structural reason as M5 paper (`docs/14_M5_Forex_Paper_Experiment.md` §2): threading a timeframe into `bot-runtime.js` would make M1 data reachable from `_maybeOpenPositionReal` the moment any real-dispatch condition was satisfied. Built instead as isolated modules with zero import overlap with any real-dispatch path.

## 3. What it does, one tick at a time

1. Read-only `getAccountInfo` for equity.
2. For each watchlist symbol: `getRates(symbol, { timeframe: 'M1', count: 100 })` + `getSymbolInfo`.
3. `evaluateM1Tick` — same `selectTrade` / `computeStopTarget` / `clampLotSize` path as M5 paper.
4. At most one open paper trade system-wide (in-memory).
5. Monitor via bid/ask vs stop/target (paper only — not broker-authoritative).

## 4. Admin UI

Admin tab **“M1 paper (experimental)”** — `GET/POST /api/v1/admin/experimental/m1-paper-{status,start,stop}`. Not reachable from the Trading page.

## 5. Test coverage

- `m1-paper-strategy.test.js` — probe stop distances, clamp-skip at $5/$10, evaluate/monitor, structural isolation.
- `m1-paper-harness.test.js` — lifecycle, open/skip/one-position, close-on-target, M1 timeframe on getRates, no placeOrder/closeOrder.

## 6. What this build explicitly does NOT do

- No real dispatch, no confirm-live, no `M1_REAL_TRADING_ENABLED`, no `placeOrder`/`closeOrder`.
- Does not touch M15 live forex, M5 real-dispatch arm state, or any existing `REAL_TRADING_ENABLED` flag.
- Does not claim M1 is ready for live trading. A **human-supervised** real test is the correct next step if paper results look clean — never an autonomous self-authorization.
