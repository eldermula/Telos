# 12 — Roadmap — Telos

> Read the full `docs/` set before starting implementation — this document sequences the work, it doesn't re-explain it. Ordering here follows one central principle: **prove the free, deterministic parts work before spending anything on the AI-driven parts.** APIRS (`08_Bot_Architecture.md` Sections 2–8) costs nothing to run and nothing to test via paper trading. The multi-agent AI layer (Section 9) costs real API calls. Building and validating in that order is the cheapest path to a working bot, not just the safest one.

---

## Guiding Principles for This Roadmap

- **Docs before code, always** (Blueprint Section 8) — every phase below assumes the relevant doc section is read first, per `11_AI_Prompt_Library.md` Section 1.
- **Cheapest, fast, reliable** — the standing project priority. Where a phase has a cheap-but-slower path and an expensive-but-faster one, default to cheap unless flagged otherwise.
- **Two decisions once blocked downstream phases — both now settled in `04_System_Architecture.md` Section 9, noted here so this roadmap doesn't drift out of sync with that resolution:**
  - Broker/MT5 connection method → official `MetaTrader5` Python package, local Python service (settled).
  - Single vs. multi broker-account per user → single, application-enforced; schema stays multi-capable (settled).
  - **What remains open is narrower than either of these:** which specific broker a *live* (real-money) account is opened with. The connection *method* works with any MT5-compatible broker — this is a live-account choice, not an architecture gap, and it doesn't block Phase 2/4 testing work, which runs against the MetaQuotes-Demo practice server.
- **Initial target is 5 real users on the self-hosted setup** (`04_System_Architecture.md` Section 8) — this roadmap builds toward that, not toward "thousands of users" scale, which is explicitly a later concern.

## Phase 0 — Foundation (Complete)

- ✅ Repo created, GitHub + Cursor connected
- ✅ Project folder structure scaffolded (`frontend/`, `backend/`, `bot/`, `database/`, `docs/`, `assets/`, `api/`, `tests/`)
- ✅ Full documentation set: `MASTER_PROJECT_BLUEPRINT.md`, `01`–`09`, `10_AI_Rules.md`, `11_AI_Prompt_Library.md`

## Phase 1 — Backend Skeleton & Infrastructure

- Node.js + Express server scaffold, Docker containerization (Blueprint Section 6)
- PostgreSQL + Redis running locally on the self-hosted machine, schema migrations from `05_Database_Design.md`
- Cloudflare Tunnel connected and verified end-to-end (a trivial `/health` endpoint reachable from the public internet through the tunnel) — proves the deployment path works before anything else is built on top of it
- Auth module (`FR-AUTH-1`–`FR-AUTH-4`; MFA deferred per `09_Security.md` Section 2)

**Exit criteria:** a deployed, empty backend that a user could theoretically sign up and log into, reachable via the real domain/tunnel.

## Phase 2 — Broker Onboarding

**No longer blocked** — connection method and cardinality are both settled (`04_System_Architecture.md` Section 9). This phase can proceed against the MetaQuotes-Demo practice server immediately; a live broker choice is only needed before Phase 9's live rollout, not before this phase.

- Implement `/broker-connections` (`06_API_Specification.md` Section 4): linking, credential encryption (`09_Security.md` Section 3), status checks.
- Key management decision (`09_Security.md` Section 3, Section 11) resolved here — this can't stay open once real credentials are being stored.

**Exit criteria:** a user can link a real broker account and see `connected` status; credentials are verifiably encrypted at rest.

## Phase 3 — APIRS Core (Deterministic, No AI Cost Yet)

This is the highest-priority phase to get right, and deliberately the cheapest to build and test:

- Implement Sections 2–8 of `08_Bot_Architecture.md` exactly: tier matrix, position sizing formula, profit-lock mechanism, macro/micro circuit breakers, Strategy B.
- **Strategy A's trade signals are stubbed/manual for this phase** — no Market Intelligence, News AI, or Strategy Engine yet (those are Phase 6). The goal here is proving the risk math, not the trade-picking logic.
- Paper-trading harness (`08_Bot_Architecture.md` Section 11) built now, since every subsequent bot phase depends on being able to validate changes without risking a real account.

**Exit criteria:** APIRS correctly computes tier, risk score, position size, profit-lock, and both circuit breakers against simulated trade sequences — verified in paper mode, zero API spend.

## Phase 4 — Trading Engine Integration & Real-Time Updates

**No longer blocked** — MT5 connection method is settled (`04_System_Architecture.md` Section 9); the order-placement leg can be built against the MetaQuotes-Demo server now.

- Wire Backend API ↔ Trading Engine ↔ Bot per `04_System_Architecture.md` Section 3.3/3.4.
- WebSocket layer (`06_API_Specification.md` Section 11) — bot status, trade events, equity updates streaming live.
- `bot_decision_log` writes wired up end-to-end (`FR-BOT-6`) — this needs to exist before any live trading, not retrofitted after.

**Exit criteria:** pressing Start/Stop in a test client actually starts/stops the paper-trading bot, and live status/events stream back over WebSocket.

## Phase 5 — Core Frontend

**Partially blocked on:** multi-account decision (affects Dashboard/onboarding layout).

- Auth screens, Broker Onboarding flow, Dashboard, Trading screen (Start/Stop, positions, decision log view) — per `07_UI_UX_Guide.md`.
- Design tokens, component library (buttons, status pills, cards) built once, reused everywhere per the UI Guide rather than per-screen.
- Deployed to Vercel, connected to the self-hosted backend through the tunnel.

**Exit criteria:** a full loop — sign up, link account (or a sandbox/paper equivalent), Start Trading, watch live paper-trade activity on the Dashboard — works end-to-end in the browser.

## Phase 6 — Multi-Agent AI Layer (First Real API Spend)

Only start this once Phase 3's deterministic core is proven — this is where the "cheapest" principle matters most, since it's the first phase with recurring API costs:

- Market Intelligence (Module 2) — rule-based/technical-indicator implementation first (free), per `08_Bot_Architecture.md` Section 9.2's "prefer free computation" guidance.
- News AI (Module 3) — free RSS/calendar sources (Section 9.3), LLM calls reserved for text parsing specifically.
- Strategy Selection Engine (Module 4) and Learning Engine (Module 6) — the two most experimental pieces; build behind the paper-trading harness from Phase 3, not live.
- AI-call cadence implemented exactly as resolved in `08_Bot_Architecture.md` Section 9.2 (15–30s cached, not per-tick) from day one — retrofitting this after building a per-tick version would be wasted work.

**Exit criteria:** the full multi-agent loop runs in paper mode, producing sensible (not necessarily profitable — that's a separate question) trade signals, at the designed cadence and cost profile.

**Status: Phase 6 complete, as of Increment 6.5 (see `CHANGELOG.md`).** The literal exit criteria above is met — the full loop (Modules 1–7 plus the Learning Engine hookup) runs end-to-end in paper mode at the designed cadence. Explicit, on-record decision: real LLM classification for Module 3 (currently a dry-run stub) and Module 4b Strategy Discovery are **not** required for this exit criteria and become their own later increments (possibly Phase 7+) rather than blocking Phase 6's close. `dailyDrawdownPct`'s hardcoded stub and Module 7's cosmetic-only per-instrument lot-sizing are tracked the same way.

**Post-Phase-6, pre-Option-2 increment (small, standalone):** the demo/live account distinction gap in `broker_connections` (flagged in `08_Bot_Architecture.md` §13 / `09_Security.md` §11) — fixed before touching Option 2 (real order placement) at all, per explicit decision. See those two sections' "Resolved" notes and `CHANGELOG.md` for detail.

## Phase 7 — Remaining Modules

- Portfolio (derived holdings), Analytics, Reports (synchronous), Notifications, Settings, AI Assistant, Admin (`06_API_Specification.md` Sections 5–13).
- Admin's `/risk-tiers` endpoints in particular — needed before Phase 8's live rollout, since tuning tiers without a redeploy is the whole point of that table existing.

**Status: Phase 7 complete, as of Increment 7.9 (see `CHANGELOG.md`).** Literal exit criteria met: every PRD module listed above has a working screen and API path against paper trading. Increments 7.8/7.9 closed both `risk_tier_config` live-wiring gaps surfaced while reviewing 7.6: Admin's `/risk-tiers` writes now reach both live position-sizing (`positionSizing.js`, 7.8) and live profit-lock/tier-advancement (`profitLock.js`, 7.9) — both via the same Redis-cached, Postgres-backed service with a hardcoded-matrix fallback (Module 2–4 pattern), proven end-to-end including the mid-trade sizing-freeze property (7.8) and the close-time live-pickup property (7.9). Explicit deferred items remain flagged rather than inventing unfinished product surfaces: `FR-ANLY-2` firm business metrics, Reports PDF library choice, and real LLM reply generation for the Assistant (stubbed like Module 3). Option 2 (real order placement into the automatic loop) remains parked and was not touched in this phase.

**Exit criteria:** every module in the PRD has a working screen and API path, still against paper trading.

## Phase 8 — Security & Operations Hardening (in progress, see `CHANGELOG.md`)

- ~~Per-endpoint rate limits~~ → **8.1, done.** General default (60/min GET, 10/min state-changing) implemented, plus four deliberately-tightened-below-default endpoint groups decided and approved before implementing: `/auth/signup` + `/auth/password-reset/*` (5/15min/IP), `/trading/session/start|stop` (5/min/user), `/admin/*` GET (20/min/admin) and its two live-risk-affecting PATCH routes (5/min/admin).
- ~~Verified encrypted backups~~ → **8.2, done.** `database/scripts/backup.js` + `restore-backup.js`; AES-256-GCM dump encryption; pushes to a private GitHub repo separate from this code repo. Ops runbook: `docs/OPS.md` §1. One-time: create the private backup repo, set `BACKUP_*` env vars, enroll Windows Task Scheduler.
- ~~`npm audit`/Dependabot~~ → **8.3, done.** `.github/dependabot.yml` + `.github/workflows/npm-audit.yml` covering `backend/` and `frontend/` (bot packages are dependency-free). Takes effect on the next push to GitHub.
- ~~Basic uptime monitoring~~ → **8.4, done (config + probe).** `GET /health` is the external target; free-tool setup (UptimeRobot) documented in `docs/OPS.md` §2. Enrolling the monitor against your live Tunnel hostname is a one-time manual step (needs the hostname).
- Minor Zod consistency gap on a few query/path inputs — pending an explicit inventory review before fixing.

**Exit criteria:** the checklist in `09_Security.md` has no unresolved item that blocks handling real user data/credentials. Remaining after 8.1–8.4: (a) one-time account setup you run (backup repo + Task Scheduler + UptimeRobot + Cloudflare WAF), (b) the Zod consistency gap pending review, (c) deliberately deferred (`09` itself: MFA, formal incident runbook, regulatory).

## Phase 9 — Limited Live Rollout

- ~~Paper-trading validation gate formally passed before any real account goes live~~ — **removed, per explicit decision in `08_Bot_Architecture.md` Section 11.** No minimum trade count or graduation criteria gates the transition to live capital. Live trading may begin as soon as implementation is complete.
- Onboard toward the confirmed initial target of 5 real users, on the self-hosted + Cloudflare Tunnel setup.
- Close monitoring via `bot_decision_log` and Notifications during this phase — this is where the design gets its first real-world feedback.

**Exit criteria:** 5 real users trading live, with the decision log and circuit breakers observably working as designed.

## Phase 10 — Post-Launch / Scale Planning (Not Yet)

Explicitly deferred, not forgotten:

- Revisit cloud migration once approaching the self-hosted setup's practical ceiling (`04_System_Architecture.md` Section 8).
- Revisit multi-broker-account support if Phase 2's decision was "single" and demand emerges.
- Revisit additional brokers beyond the first one chosen in Phase 2.
- Revisit MFA (`FR-AUTH-5`) and any regulatory/compliance follow-up flagged in `09_Security.md` Section 11.

---

*This is the last document in the original doc set (`01`–`12` + `AI_Rules` + `AI_Prompt_Library` + `CHANGELOG`). `CHANGELOG.md` starts getting real entries once Phase 1 implementation actually begins.*