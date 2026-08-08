# 13 — Synthetics Probe Report — Telos

> Design-first live probe before any synthetics trading code. Same discipline crypto got before its Increment E. **No trading code in this pass.** Threshold numbers below are a first cut pending the report-before-build gate.

**Status:** probe complete; **paper pathway built** (owner accepted this report). Account used for probe/smoke: Deriv-Demo login `6255429`. Script: `backend/scripts/probe-synthetics-scoping.js`. Raw JSON: `backend/scripts/probe-synthetics-scoping-report.json`. Runtime: `backend/src/engine/synthetic-bot-runtime.js` + `/api/v1/bot/synthetic/*` + Trading UI panel — paper only, no real orders.

**Prerequisite confirmation:** `docs/11_Crypto_Synthetics_Scoping.md` is the resolved version (Status: scoped and decided; §0.2 and §6 settled). This report replaces §6.3's unverified Volatility Indices guess with live catalog data; it does **not** by itself reopen the crypto-alone product decision in §6.1 — that remains an owner call.

---

## 1. Catalog — exact MT5 symbols (live)

On Deriv-Demo, synthetic products are under path prefixes including `Volatility Indices\`, `Crash Boom Indices\`, `Jump Indices\`, `Step Indices\`, `DEX Indices\`, `High Frequency Vol`, `Crash Boom Flip`, `Skewed Step`. **74** synthetic-family symbols visible to `symbols_get`.

**Volatility Indices (exact names — spaces and casing matter; `R_10`/`R_25` aliases do not resolve):**

| Cadence | Symbols confirmed live |
|---|---|
| Standard | `Volatility 5 Index`, `Volatility 10 Index`, `Volatility 15 Index`, `Volatility 25 Index`, `Volatility 30 Index`, `Volatility 50 Index`, `Volatility 75 Index`, `Volatility 90 Index`, `Volatility 100 Index` |
| 1-second | `Volatility 5 (1s) Index` … `Volatility 100 (1s) Index`, plus `Volatility 150 (1s) Index`, `Volatility 250 (1s) Index` |
| HF Vol (separate family) | `High Frequency Vol 10/25/50/75/100 Index` |

§6.3's Boom/Crash/Jump caution stands: those remain **out of first-cut scope** (designed spike shape ≠ continuous vol). Probe focused on continuous Volatility Indices only.

---

## 2. Method

- Timeframe: M15, up to 1000 bars via connector `/rates` (read-only).
- ATR ratio: Wilder ATR(14) / SMA(last 20 ATR) — same Module 2 math as forex/crypto.
- `trend_quality`: `clamp(ADX/50, 0, 1)` — same Module 2.
- Starter strategy gates (migration `004`): EMA `trend_quality_min 0.6`; Breakout `market_volatility_in ["HIGH"]`; RSI `trend_quality_max 0.4`.
- Signal fire rates: walk-forward edge counts using `bot/strategy-engine` detectors (EMA cross, breakout, RSI — RSI also counted as edge-entry for fairness since the detector is level-based today).

---

## 3. Core empirical finding — ratio vs absolute vol

Designed fixed volatility shows up as **absolute** ATR (% of price), not as a fat ATR-ratio distribution:

| Symbol | ATR % of mid price (mean) | Ratio p10 / p50 / p90 | Proposed ratio cut (p10/p90→0.05) | Forex-band HIGH share (0.8/1.3) |
|---|---|---|---|---|
| Volatility 5 Index | 0.042% | 0.944 / 0.997 / 1.061 | 0.95 / 1.05 | **0.0%** |
| Volatility 10 Index | 0.083% | 0.938 / 0.996 / 1.068 | 0.95 / 1.05 | **0.0%** |
| Volatility 15 Index | 0.125% | 0.948 / 0.999 / 1.054 | 0.95 / 1.05 | **0.0%** |
| Volatility 25 Index | 0.213% | 0.942 / 1.000 / 1.056 | 0.95 / 1.05 | **0.0%** |
| Volatility 30 Index | 0.243% | 0.945 / 0.999 / 1.059 | 0.95 / 1.05 | **0.0%** |
| Volatility 50 Index | 0.417% | 0.951 / 1.001 / 1.052 | 0.95 / 1.05 | **0.0%** |
| Volatility 75 Index | 0.628% | 0.936 / 0.996 / 1.058 | 0.95 / 1.05 | **0.0%** |
| Volatility 90 Index | 0.725% | 0.940 / 0.996 / 1.064 | 0.95 / 1.05 | **0.0%** |
| Volatility 100 Index | 0.840% | 0.953 / 0.998 / 1.054 | 0.95 / 1.05 | **0.0%** |

Absolute ATR% scales almost linearly with the index number (Vol 10 ≈ 2× Vol 5, Vol 100 ≈ 10× Vol 10). The **ratio** collapses to ~0.95–1.05 for every variant — so a naïve "per-symbol ratio threshold" first cut yields the **same** `0.95 / 1.05` band everywhere.

**Implication for Module 2:** under unmodified forex/crypto cutoffs (`0.8` / `1.3`), synthetics almost never leave `NORMAL`. Tightening to `0.95` / `1.05` manufactures LOW/HIGH from tiny stationary noise. **Flag for build gate:** ratio-based HIGH/LOW may be the wrong primary regime axis for designed-fixed-vol instruments; absolute vol (or a synthetics-specific regime model) may be needed instead. Treat `0.95/1.05` as a documented first cut only, not a settled calibration.

1s variants show the same ratio collapse; absolute ATR% still tracks the index number (e.g. Vol 250 (1s) ≈ 1.94% of price).

---

## 4. Strategy fit — assessed individually (not as a pool)

Starter gates + M15 walk-forward over ~960 evaluated bars per symbol.

### EMA cross (`trend_quality_min 0.6`)

- Mean `trend_quality` sits ~0.45–0.53 across standard Vol indices — not stuck forever in the noisy middle, but not strongly trending either.
- EMA gate open share: ~17–31% (standard). Noisy middle (0.4–0.6): ~29–43%.
- Verdict mix: **PLAUSIBLE** on Vol 5/15/25/75; **MARGINAL** on Vol 10/30/50/90/100 (gate opens sometimes, crosses fire but thin).
- Transfer is possible but weaker than a trending FX major. Do not assume EMA works just because RSI does.

### Breakout (`market_volatility_in: HIGH`)

- Under **current forex bands** `0.8/1.3`: HIGH share **0.0%** on every Volatility Index probed → primary verdict **WEAK** — the regime gate starves before the signal logic matters.
- Raw breakout *edges* still appear in price (often ~10–15 per 100 bars) — the price-shape can print breaks; the **regime_fit** as written will not let Selection use them without a synthetics-specific vol model or a breakout `regime_fit` change.
- Confirms §1's warning: this is not a simple shared-threshold transplant from forex/crypto.

### RSI reversion (`trend_quality_max 0.4`)

- RSI gate open share: ~28–52% on standard Vol indices — consistently the most open gate.
- Edge entries fire (~2–4 per 100 bars). Verdict: **PLAUSIBLE** across essentially the whole standard set.
- Best transfer candidate of the three; still needs paper validation, not a free pass.

**Bottom line:** the three strategies do **not** stand or fall together. RSI is the strongest transfer; EMA is mixed; Breakout is blocked by the current HIGH-vol regime gate on this process.

---

## 5. Contract / tick notes (Module 7 foreshadowing)

All probed Volatility Indices: `trade_contract_size = 1.0`, `trade_mode_full = true`, live bid/ask on standard Vol indices at probe time.

`volume_min` differs by symbol (examples): Vol 10 = 0.5, Vol 50 = 4.0, Vol 75 = 0.01, Vol 100 = 1.0, Vol 25 (1s) = 0.005, Vol 250 (1s) = 10.0. Spreads also differ widely. **Module 7 specs must be per-symbol**, even if ratio bands are shared within the family.

---

## 6. Recommendations (report-before-build)

1. **Runtime file: own `synthetic-bot-runtime.js`.** Do not fold into `crypto-bot-runtime.js`. Both are 24/7 and both are "new," but (a) designed-fixed vol + near-stationary ATR ratios are unlike crypto's empirical regime distribution, and (b) §3's explicit **no-news-correlation** design is a hard architectural difference from crypto's shock-news pipeline. Surface similarity is not enough.

2. **Instrument scope first cut:** continuous **Volatility Indices**, standard cadence. Suggested initial watchlist (liquidity / classic set, not the whole catalog): `Volatility 10 Index`, `Volatility 25 Index`, `Volatility 50 Index`, `Volatility 75 Index`, `Volatility 100 Index`. Defer Boom/Crash/Jump. Park 1s / HF Vol as a later sub-watchlist.

3. **Thresholds first cut:** family-level ratio band `lowMax=0.95` / `highMin=1.05` (observed across all variants), with the explicit caveat that this may be the wrong lever — final calibration must revisit whether Module 2's categorical vol should use absolute designed-vol or a different regime signal. Keep **per-symbol** Module 7 / spread params.

4. **News:** fixed neutral / N/A for synthetics (§3) — intentional exclusion in the synthetic dispatcher, not "no source found."

5. **No trading code until this report is accepted** (or amended) by the owner. Next isolated pieces after acceptance would mirror crypto A–D: specs normalizer, vol/regime module, no-news stub, then paper dispatcher — each gated.

---

## 7. Account verification cross-link (Task 3)

See CHANGELOG entry for login `6255429` / `Deriv-Demo`. Connector health OK; account-info matches; Volatility Index symbol-info live. Crypto `BTCUSD`/`ETHUSD` returned `trade_mode_full` but **bid/ask = 0** on this attach — not clean for crypto quote work until ticks are real. Synthetics Vol indices were clean.
