# 16 — XAUUSD VWAP p90 Stretch-Reversion Paper Experiment

**Status:** PAPER-ONLY, experimental, **candidate signal — not proven**.  
**Scope:** XAUUSD + M5 only (the only instrument/timeframe combination that cleared n≥15 with positive E[R] in tonight's costed backtest).  
**Hard boundary:** this experiment must never place a real order. There is no XAU VWAP real-dispatch module, no confirm-live route, and no env kill switch for this strategy. Enabling real dispatch is a separate, human-supervised future decision — not something this build unlocks.

## 1. Why this exists

Tonight's diagnostics tested ten+ ideas. After spread-aware stops and 2R targets, **only one** configuration cleared the n≥15 trust threshold with positive expectancy:

| Metric | XAUUSD M5, VWAP p90 cross, trade toward VWAP |
|---|---|
| n | 16 |
| Win rate | 43.8% |
| E[R] | +0.31 |

Sample window: ~3.5 days of cached M5 bars (~1000 bars). **This is not a validation — it is a candidate worth extended paper observation.**

### Raw reclaim vs costed E[R] (reason for skepticism)

Tonight's VWAP probe measured **50% gap reclaim** within 12 bars on M5 XAUUSD p90 crosses: **0% hit rate** (0/16). The costed backtest with the same 16 signals reported **+0.31 E[R]** with spread-aware stops and 2R targets. Those metrics measure different things; the divergence is explicitly **a reason to stay skeptical**, not a reason to treat the backtest as confirmation of the raw reclaim story.

## 2. Signal definition (matches tonight's probe + costed backtest)

- **Instrument:** XAUUSD only  
- **Timeframe:** M5 only  
- **VWAP:** intraday cumulative, reset each UTC day; typical = (H+L+C)/3; volume = tick_volume (min 1)  
- **Threshold:** empirical **p90** of |close−VWAP| recomputed from live bar history each evaluation (not hardcoded)  
- **Signal:** first bar per UTC day where |close−VWAP| crosses **up** through the p90 threshold (prev below, now at/above, same day)  
- **Direction:** trade **toward VWAP** — above VWAP → SELL, below VWAP → BUY  
- **Stop:** `max(1.5×ATR14, 2.0×live spread)`  
- **Target:** 2R  
- **Entry:** BUY at ask, SELL at bid (spread embedded)

## 3. Architecture (isolation)

Mirrors M5/M1 paper isolation:

| Module | Role |
|---|---|
| `backend/src/engine/xau-vwap-paper-strategy.js` | Pure math — VWAP, p90 detection, spread-aware stop, lot clamp |
| `backend/src/engine/xau-vwap-paper-harness.js` | Admin singleton; read-only `getRates`/`getSymbolInfo`/`getAccountInfo` |

**Structural guarantees:**

- Zero import overlap with `placeOrder`/`closeOrder`, `bot-runtime.js`, `m5-real-*`, confirm-live, or `REAL_TRADING_ENABLED`
- No `bot_instances` row, no DB writes, in-memory history only
- Admin routes: `GET/POST /api/v1/admin/experimental/xau-vwap-paper-{status,start,stop}`
- Admin UI tab: **"XAU VWAP paper (experimental)"** — separate from M5/M1 panels

## 4. What extended paper validation should show

Before any real-dispatch consideration (separate human decision):

1. **Sample size:** many more closed paper trades than n=16 across varied sessions  
2. **Stability:** E[R] and win rate hold with live p90 recalculation (not a fixed threshold from one backtest week)  
3. **Raw vs costed alignment:** understand whether live paper outcomes resemble reclaim hits or 2R stop/target math  
4. **No clamp/skip surprises:** XAUUSD at $10 balance (same probe context as other experiments)

## 5. Explicit non-goals (this build)

- No generalization to EURUSD/GBPUSD or M15/M1  
- No wiring into M5 real-dispatch or the Trading page  
- No automatic promotion to real trading based on paper results  
- No new migrations or `asset_class` enum values (paper-only, no DB trades)

## 6. Tests

- `xau-vwap-paper-strategy.test.js` — p90 detection, spread-aware stop formula, tick evaluation, isolation grep  
- `xau-vwap-paper-harness.test.js` — lifecycle, open on stretch cross, fake connector without order APIs

## 7. Recommendation path (if paper eventually looks good)

1. Extended paper run via this harness (weeks, not hours)  
2. Human-reviewed decision document — still skeptical given raw/costed divergence  
3. **Separate** implementation task for real dispatch (new safety layers, confirm-live, etc.) — explicitly out of scope for this experiment
