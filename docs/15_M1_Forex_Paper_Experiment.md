# 15 — M1 Forex/Gold Paper Experiment

**Status:** PAPER-ONLY, experimental, **not ready for real dispatch**.  
**Built:** 2026-08-11/12 from a live M1 probe (1000 bars/instrument).  
**Hard boundary:** this experiment must never place a real order. There is no M1 real-dispatch module, no `M1_REAL_TRADING_ENABLED`, and no confirm-live route for M1. Enabling real dispatch for M1 is a separate, human-supervised future decision — not something this build unlocks.

## 1. Probe findings this build is based on

Live connector data, M1 timeframe, 1000 bars/instrument across EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, XAUUSD (~15 wall-clock hours of M1 bars in the eval window).

### Original ATR-only stop distances (1.5× ATR14 on M1) — pre-fix baseline

| Symbol | ATR14 | Stop (1.5×) | Min viable balance | At $5 | At $10 |
|---|---|---|---|---|---|
| EURUSD | 0.00004408 | 0.00006612 | $0.34 | ok | ok |
| GBPUSD | 0.00005449 | 0.00008173 | $0.41 | ok | ok |
| USDJPY | 0.00444853 | 0.00667279 | $21.32 | SKIP | SKIP |
| AUDUSD | 0.00005291 | 0.00007936 | $0.40 | ok | ok |
| USDCAD | 0.00003590 | 0.00005385 | $0.27 | ok | ok |
| XAUUSD | 0.88525252 | 1.32787878 | $6.64 | SKIP | ok |

Compared to M5: ATR-only M1 stops were much tighter (roughly 4–5× smaller). That tightness caused Session A’s immediate stop-outs (see §6) and is why the stop formula was corrected (§1b).

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

## 1b. Spread-aware stop fix (2026-08-12)

### Live spread probe (read-only, 8 bid/ask samples/symbol)

| Symbol | Mean spread | Max spread | M1 1.5×ATR (live) | M1 stop / mean spread | Inside mean? |
|---|---|---|---|---|---|
| EURUSD | 0.000129 | 0.000130 | 0.000046 | 0.36× | **yes** |
| GBPUSD | 0.000136 | 0.000140 | 0.000074 | 0.55× | **yes** |
| USDJPY | 0.015000 | 0.015000 | 0.007836 | 0.52× | **yes** |
| AUDUSD | 0.000127 | 0.000130 | 0.000053 | 0.42× | **yes** |
| USDCAD | 0.000150 | 0.000150 | 0.000037 | 0.24× | **yes** |
| XAUUSD | 0.182500 | 0.190000 | 3.320411 | 18.19× | no |

All five FX majors had M1 ATR stops **inside** the live bid/ask spread — matching Session A (USDCAD immediate stop-outs).

### Chosen formula

```
stop_distance = max(1.5 × ATR14, SPREAD_STOP_MULTIPLE × live_spread)
SPREAD_STOP_MULTIPLE = 2.0
```

**Why 2.0 (not 1.0):** a BUY fills at ask; the monitor marks to bid. At entry the adverse side is already `1×spread` worse than entry. A floor of `1.0×spread` places the stop at/through the opposite side of the book immediately. `2.0×` clears the book and leaves one full spread of buffer for within-tick noise. Observed FX spreads (~1.3–1.5e-4 on majors, 0.015 on USDJPY) made this the minimum that addresses the Session A mechanism without inventing a larger multiple blindly.

Implemented only in `m1-paper-strategy.js` (M5 untouched — see §1c). Constant exported as `SPREAD_STOP_MULTIPLE`.

### Min-viable balance after the fix

Recomputed with **original probe ATR14** + **observed mean spreads** (so the delta is the formula change, not a different ATR day). Ceiled to cents so `clampLotSize` clears:

| Symbol | Old stop (ATR) | New stop | Old min $ | New min $ | Δ | At $5 | At $10 |
|---|---|---|---|---|---|---|---|
| EURUSD | 0.00006612 | 0.0002575 | $0.34 | **$1.29** | +$0.95 | ok | ok |
| GBPUSD | 0.00008173 | 0.0002725 | $0.41 | **$1.37** | +$0.96 | ok | ok |
| USDJPY | 0.00667279 | 0.0300000 | $21.32 | **$50.01** | +$28.69 | SKIP | SKIP |
| AUDUSD | 0.00007936 | 0.0002550 | $0.40 | **$1.28** | +$0.88 | ok | ok |
| USDCAD | 0.00005385 | 0.0003000 | $0.27 | **$1.51** | +$1.24 | ok | ok |
| XAUUSD | 1.32787878 | 1.32787878 | $6.64 | **$6.64** | $0 | SKIP | ok |

FX mins roughly 3–6× higher; XAU unchanged (ATR stop already ≫ 2×spread). USDJPY still not viable at $5/$10.

## 1c. M5 read-only spread-safety check (no M5 code change)

Same live spreads vs live M5 1.5×ATR stops:

| Symbol | M5 stop | Mean spread | M5 / mean | Inside mean? | Inside max? |
|---|---|---|---|---|---|
| EURUSD | 0.000131 | 0.000129 | 1.02× | no | no |
| GBPUSD | 0.000194 | 0.000136 | 1.42× | no | no |
| USDJPY | 0.025269 | 0.015000 | 1.68× | no | no |
| AUDUSD | 0.000162 | 0.000127 | 1.27× | no | no |
| USDCAD | 0.000153 | 0.000150 | 1.02× | no | no |
| XAUUSD | 5.636954 | 0.182500 | 30.89× | no | no |

**Finding:** M5 does **not** currently show the Session A failure mode (stops inside typical spread). No M5 code change in this task. Caveat: EURUSD and USDCAD M5 stops are only ~1.02× mean spread — thin buffer, not “inside,” but worth watching if spreads widen. Do not apply the M1 floor to M5 without a confirmed M5 problem.

## 2. Why a separate harness (not a timeframe flag on the live runtime)

Same structural reason as M5 paper (`docs/14_M5_Forex_Paper_Experiment.md` §2): threading a timeframe into `bot-runtime.js` would make M1 data reachable from `_maybeOpenPositionReal` the moment any real-dispatch condition was satisfied. Built instead as isolated modules with zero import overlap with any real-dispatch path.

## 3. What it does, one tick at a time

1. Read-only `getAccountInfo` for equity.
2. For each watchlist symbol: `getRates(symbol, { timeframe: 'M1', count: 100 })` + `getSymbolInfo`.
3. `evaluateM1Tick` — same `selectTrade` path as M5 paper, then **spread-aware** stop/target (`max(1.5×ATR, 2×live_spread)`), then `clampLotSize`.
4. At most one open paper trade system-wide (in-memory).
5. Monitor via bid/ask vs stop/target (paper only — not broker-authoritative).

## 4. Admin UI

Admin tab **“M1 paper (experimental)”** — `GET/POST /api/v1/admin/experimental/m1-paper-{status,start,stop}`. Not reachable from the Trading page.

## 5. Test coverage

- `m1-paper-strategy.test.js` — ATR baseline vs original probe, spread-floor fixtures from live mean spreads (`SPREAD_STOP_MULTIPLE = 2.0`), clamp-skip at $5/$10 with new mins, evaluate/monitor, structural isolation.
- `m1-paper-harness.test.js` — lifecycle, open/skip/one-position, close-on-target, M1 timeframe on getRates, no placeOrder/closeOrder.
- Unit suite: **45/45 pass** after the spread-aware change.

## 6. Live paper-session results

### Session A — signal burst (~15 min) — ATR-only (pre-fix)

| Metric | Value |
|---|---|
| Closed trades | **6** |
| Wins / losses | **0 / 6** |
| Total paper PnL | **≈ −$6.00** (on $10 equity snapshot, 10% bootstrap risk) |
| Symbol / strategy | **USDCAD only**, all **MA Crossover** |
| Hold time | ~15s each (stop-hit on the next tick) |
| Typical stop distance | ~0.000077–0.00008 |

Observation: M1 ATR-based stops were inside bid/ask spread — every entry stopped immediately. Mechanism finding, confirmed by the §1b spread probe.

### Session B — judgment continuation (~15 min) — ATR-only (pre-fix)

| Metric | Value |
|---|---|
| Closed trades | **0** |
| Notable decisions | 20× `data_fetch_error`, 3× XAUUSD `skipped_below_volume_min` |

### Session C — spread-aware re-run (2026-08-12), hard 5-minute wall-clock box

Runner: `scripts/run-m1-paper-5min.js`. Stopped at exactly 5.00 minutes — no extension.

| Metric | Value |
|---|---|
| Ticks | **20** |
| Opened / closed | **0 / 0** |
| Wins / losses | **n/a** |
| Survived past one tick | **n/a** (no closed trades) |
| Immediate one-tick stop-outs | **0** (none observed — no fills) |
| Notable decisions | 14× `data_fetch_error` (connector contention) |

Honest short sample: quiet gates + connector noise; no trade opened in the 5-minute window, so this run neither confirms nor re-creates Session A’s immediate stop-out failure mode. It does confirm the harness runs cleanly with the new formula under the hard boundary (read-only only).

### Session C′ — same formula, earlier interrupted judgment sample (same day, before the 5-min box)

Before the hard 5-minute re-run, a longer judgment harness under the same spread-aware formula had already produced:

| Metric | Value |
|---|---|
| Opened (floored) | **2** (both `flooredBySpread: true`, stop ≈ 0.00024–0.00026) |
| Closed | **1** — AUDUSD Breakout, **stop-hit**, paper PnL ≈ −$0.96 |
| Hold on that close | **270s** (~18× the 15s tick) |
| Immediate one-tick stop-outs | **0 / 1** |
| Still open when interrupted | AUDUSD BUY held **>30 minutes** with floored stop |

That sample is the direct contrast to Session A’s 6/6 ~15s stop-outs: with `SPREAD_STOP_MULTIPLE = 2.0`, the observed filled trades survived many ticks.

### Session D — open-ended judgment run, operator-stopped (2026-08-12)

Runner: `scripts/run-m1-paper-judgment.js`. Archive: `backend/_m1-paper-run-FINAL-operator-stop-2026-08-12T02-03-23-604Z.json` (timestamped; not overwritten by later `_m1-paper-run-results.json` writes). Stopped by operator before any judgment stop condition fired.

| Metric | Value |
|---|---|
| Elapsed | **~69.4 min** |
| Ticks | **274** |
| Opened | **1** |
| Closed | **0** |
| Wins / losses | **0 / 0** |
| Total closed PnL | **$0** (nothing resolved) |
| `data_fetch_error` | **49** for the whole session (~0.18 per tick) |
| Stop reason | `operator_stopped` |

**Only open (still unresolved at stop — no forced close):**

| Field | Value |
|---|---|
| Symbol / direction | **GBPUSD SELL** |
| Strategy | RSI Mean Reversion |
| Entry | **1.35083** |
| Stop / target | 1.35105 / 1.35039 |
| Stop distance | **0.00022** (`flooredBySpread: true`; ATR stop was ~0.000146) |
| Lot | 0.05 |
| Opened at | 2026-08-12T01:47:42.022Z |
| Hold at stop | **~15+ minutes** still open |

**Session ended with an open position, no forced resolution.**

**Closed trades:** none.

Quiet-stretch probes the same day showed multi-hour gaps between gate-qualified fires are normal; a ~69 min run with one open and zero closes is consistent with that, not a harness failure. The open GBPUSD SELL surviving well past one tick under the spread floor is further evidence against Session A’s immediate-stop-out mode — but **zero closed outcomes** means this session still cannot speak to win/loss quality.

## 7. Code review (M1 build) — findings

**Fixed:**
1. `tickInFlight` guard — overlapping ticks when a tick exceeds `tickMs`.
2. Empty/malformed `bars` guard before pushing an instrument into `evaluateM1Tick`.
3. `getStatus().closedTrades` slice raised 20→100.
4. **Spread-aware stop distance** (`SPREAD_STOP_MULTIPLE = 2.0`) — addresses Session A / §1b.

**Flagged (not fixed — needs product/threshold decisions):**
1. M15-tuned `trend_quality` / volatility gates were reused unchanged; probe showed they open at similar rates but fire rates per wall-clock hour do **not** scale with candle frequency. Quiet-stretch measurement: watching all six instruments, ~half of inter-fire gaps exceed 30 minutes; worst in-session dry spell ~9.7h on M5.
2. Connector contention (`Unable to select symbol` / −10004) remains a structural MT5-connector issue, not M1-specific.
3. Paper monitor is price-vs-stop (not broker-authoritative) — fine for paper measurement, must not be confused with a live close model.
4. No `M1` real-dispatch path exists (intentional). Do not add one until a human reviews a supervised paper period with a multi-symbol **closed** sample including wins and losses.

## 8. Recommendation

**Do not run a human-supervised M1 real test yet.**

What is now supported by paper evidence:
- Session A’s immediate stop-out mechanism is addressed by the spread floor (C′ multi-tick holds; Session D open still alive after ~15+ min).

What is **not** yet supported:
- No multi-symbol closed sample under the new formula with both wins and losses (Session D: **0 closes**).
- Fire rates remain sparse under M15-tuned gates; expectancy on M1 is unproven.

**Verdict:** recalibrate/re-test in paper (longer sample and/or gate review) — **not** ready for a supervised real test.

Recommended next steps (human-led, separate session):
1. Longer paper under the new formula until a multi-symbol **closed** sample includes both wins and losses.
2. Only then consider a **human-supervised** real proof (demo first), with a new Layer-1 kill switch — never auto-enabled from this paper build.

## 9. What this build explicitly does NOT do

- No real dispatch, no confirm-live, no `M1_REAL_TRADING_ENABLED`, no `placeOrder`/`closeOrder`.
- Does not touch M15 live forex, M5 real-dispatch arm state, M5 stop formula, or any existing `REAL_TRADING_ENABLED` flag.
- Does not self-authorize any transition to real trading.
