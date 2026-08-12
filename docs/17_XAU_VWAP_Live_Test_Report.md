# XAUUSD VWAP p90 — Live Market Test Report

### Environment

* Cursor runtime (agent terminal)
* Broker: MetaAPI / MT5 connector (project default)
* Account type: real
* Demo/sandbox login (masked): 22****97
* Market-data source: live MT5 connector `getRates(XAUUSD, M5)`
* Test start: 2026-08-12T12:26:56.621Z
* Test end: 2026-08-12T12:57:00.522Z

### Market Test

* Instrument: XAUUSD
* Timeframe: M5
* VWAP: rolling intraday (live bars)
* p90: empirical percentile on live window (not hardcoded)
* Live candles observed: 120
* Valid signals: 0
* Executions: 0
* Rejected signals/orders: 1

### Execution

```json
[]
```

### Verification

| Component | Result |
| --- | --- |
| Live market data | ok |
| VWAP / p90 / spread path | exercised when snapshot present |
| Dispatcher / risk / kill switch | enforced via harness Layers 0–2 (real) or 0–3 (demo) |
| Fabricated values | **none** (fabricated=false) |
| Strategy disabled after test | yes (harness stopped; operator restores kill switch to false) |

### Notes

* initial snapshot ok=true tick_outcome=no_signal
* OPERATOR-AUTHORIZED REAL-MONEY dispatch: XAU_VWAP_LIVE_ALLOW_REAL=true; demo Layer 2b/3 not used; Layer 2 confirm-live + Layer 1 kill switch only
* confirm-live phrase accepted via adminService

### Final Result

**LIVE TEST COMPLETED — NO VALID SIGNAL**

> A **PASSED** result requires a verified signal→dispatch→fill→monitor path
> through the existing real-dispatch architecture (demo, or real with explicit
> `XAU_VWAP_LIVE_ALLOW_REAL`). No fabricated fills. Historical/paper E[R]
> was not used as an execution assumption.
