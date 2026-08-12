# XAUUSD VWAP p90 — Live Market Test Report

### Environment

* Cursor runtime (agent terminal)
* Broker: MetaAPI / MT5 connector (project default)
* Account type: real
* Demo/sandbox login (masked): 22****97
* Market-data source: live MT5 connector `getRates(XAUUSD, M5)`
* Test start: 2026-08-12T11:43:31.800Z
* Test end: 2026-08-12T11:58:35.626Z

### Market Test

* Instrument: XAUUSD
* Timeframe: M5
* VWAP: rolling intraday (live bars)
* p90: empirical percentile on live window (not hardcoded)
* Live candles observed: 120
* Valid signals: 0
* Executions: 0
* Rejected signals/orders: 0

### Execution

```json
[]
```

### Verification

| Component | Result |
| --- | --- |
| Live market data | ok |
| VWAP / p90 / spread path | exercised when snapshot present |
| Dispatcher / risk / kill switch | enforced (non-demo = no placeOrder; demo = harness Layers 0–3) |
| Fabricated values | **none** (fabricated=false) |
| Strategy disabled after test | yes (no live harness left running; kill switch left off after operator disable) |

### Notes

* initial snapshot ok=true tick_outcome=no_signal
* Linked account_type=real — first controlled live test refuses placeOrder on non-demo. Running READ-ONLY live observation (VWAP/p90/signal detect only; no dispatch).
* strategy remained DISABLED for real-money dispatch (no harness start)

### Final Result

**LIVE TEST COMPLETED — NO VALID SIGNAL**

> A **PASSED** result requires a demo/sandbox account and a verified
> signal→dispatch→fill→monitor path. Read-only observation on a real
> account that finds no signal correctly reports **NO VALID SIGNAL**.
> Historical/paper E[R] was not used as an execution assumption.
