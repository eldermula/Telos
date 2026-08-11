# 04 — System Architecture — Telos

> Read `MASTER_PROJECT_BLUEPRINT.md`, `03_Software_Requirements_Specification.md`, and `08_Bot_Architecture.md` first. This document shows how the approved components (Blueprint Section 7) fit together end-to-end. It treats the Trading Bot as a single box — its internals are fully specified in `08_Bot_Architecture.md`.

---

## 1. Purpose & Scope

Defines the system-level component boundaries, data flow, and integration points for Telos — how a user action (e.g. "Start Trading") travels through the stack to an executed trade and back to the dashboard as live data.

## 2. High-Level Component Diagram

```
┌─────────────┐      ┌───────────────────┐      ┌────────────────┐
│  FRONTEND   │◄────►│    BACKEND API     │◄────►│    DATABASE     │
│ React + TS  │ REST/│  Node.js + Express │      │  PostgreSQL    │
│   + Vite    │  WS  │  JWT Auth          │      │  + Redis       │
└─────────────┘      └─────────┬──────────┘      └────────────────┘
                                │
                                ▼
                      ┌───────────────────┐
                      │  TRADING ENGINE    │  (backend-side coordinator —
                      │  (backend module)   │   relays Start/Stop, receives
                      └─────────┬──────────┘   bot state & trade events)
                                │
                                ▼
                      ┌───────────────────┐
                      │   TRADING BOT       │  Full internal design in
                      │  (APIRS + Multi-    │  08_Bot_Architecture.md
                      │   Agent System)      │  (Modules 1–7)
                      └─────────┬──────────┘
                                │
                                ▼
                      ┌───────────────────┐
                      │  MT5 CONNECTOR      │  Python + official
                      │  (Execution Engine,  │  MetaTrader5 package —
                      │  Bot Module 7)        │  see Section 3.6
                      └─────────┬──────────┘
                                │
                                ▼
                      ┌───────────────────┐
                      │  Local MT5 Terminal  │  one instance per linked
                      │  (per user account)   │  broker account (Section 3.6)
                      └─────────┬──────────┘
                                │
                                ▼
                           [ Broker → Markets ]
```

**The frontend never has a direct line to any box below the Backend API.** This is the Blueprint Section 5 boundary, enforced structurally by this diagram, not just by convention.

## 3. Component Responsibilities

### 3.1 Frontend (React + TypeScript + Vite)
- Renders all modules from the PRD (Dashboard, Trading, Portfolio, Analytics, Reports, Notifications, Settings, Admin, AI Assistant UI)
- Talks to the Backend API exclusively via REST (commands/queries) and WebSockets (live updates)
- Never stores broker credentials, never calls MT5/broker/trading engine directly

### 3.2 Backend API (Node.js + Express + JWT)
- Owns Auth, session management, and all REST endpoints (full contract in `06_API_Specification.md`)
- Stores broker credentials encrypted at rest, handles broker account linking (`FR-ONB-1`–`FR-ONB-6`)
- Hosts the WebSocket server that pushes live trading activity, bot status, and equity updates to the Frontend (`NFR-3`)
- Is the only component permitted to talk to the Trading Engine

### 3.3 Trading Engine (backend-side coordinator)
- Receives Start/Stop Trading commands from the Backend API and relays them to the Trading Bot
- Receives trade events, status changes, and equity updates from the Bot and passes them back to the Backend API for storage and WebSocket broadcast
- Acts as the boundary between "web request/response world" (Backend API) and "continuous event-driven world" (the Bot) — this separation keeps the Bot's internal tick loop independent of HTTP request/response timing

### 3.4 Trading Bot (APIRS + Multi-Agent System)
- Full internal architecture, risk engine, and orchestration logic: see `08_Bot_Architecture.md`
- From this document's perspective, the Bot is a single component with three interfaces: (1) receives Start/Stop and account context from the Trading Engine, (2) executes trades against the linked broker account, (3) emits status/trade events back to the Trading Engine
- Runs as its own long-lived process/service (not inside a request/response cycle), matching the `bot/` top-level folder in the Blueprint

### 3.5 Database (PostgreSQL + Redis)
- **PostgreSQL** — durable storage: user accounts, encrypted broker credentials, trade history, reports, settings, audit logs (including the `FR-BOT-6` decision log)
- **Redis** — fast-changing/ephemeral state: live bot status, session/cache data, rate-limiting counters
- Full schema in `05_Database_Design.md`

### 3.6 MT5 / Broker Layer

**Connection method — confirmed: the official `MetaTrader5` Python package.** Free, native, and Windows-only — which happens to match the self-hosted machine's OS exactly, so no third-party bridge service or paid API is needed. This is a scoped exception to the Node.js-only backend stack (Blueprint Section 6): the MT5 connector runs as a small local Python service, called by the Bot's Execution Engine (`08_Bot_Architecture.md` Module 7) over an internal API — the rest of the Bot and the entire Backend API remain Node.js/Express as approved.

**How it works:** the official library drives a locally running MT5 terminal instance per linked account. **Connection cardinality (Crypto Increment A / `11` §0.2):** the database allows one connection per `(user_id, broker_id)` — so a future crypto pathway can link a second broker without removing the bounded-cardinality guarantee. **The API still enforces a single connection per user** (`409 CONNECTION_ALREADY_EXISTS`) until a later control-plane increment relaxes that check; today that still means at most one MT5 terminal instance per user, which keeps resource usage on the 8GB self-hosted machine predictable at the confirmed 5-user initial scale (Section 8). This wouldn't hold up unchanged at "thousands of users" — noted in Section 9 as part of the longer-term scaling question, not a problem to solve now.

- The user's own linked broker account (Blueprint 5a — non-custodial)
- Credentials (MT5 login, password, server) captured once via `/broker-connections` (`06_API_Specification.md` Section 4), encrypted at rest, passed to the local MT5 terminal only at connection time — never persisted by the Python connector itself, only by the Backend API's encrypted storage (`09_Security.md` Section 3)

**Starting the connector locally:** part of the standard local-stack startup — see `OPS.md` Section 0, `scripts/start-everything.ps1`. Starts the connector in its own window and waits for `/health`, then `/account-info`, before the rest of the stack comes up.

## 4. Core User Flow, Mapped to Components

Matches the flow defined in `01_Project_Vision.md` Section 5 and `02_Product_Requirements.md` Section 3.2:

1. **Link broker account** — Frontend form → Backend API (`FR-ONB-1`) → credentials encrypted and stored in PostgreSQL → Backend validates connection against MT5/broker.
2. **Press "Start Trading"** — Frontend → Backend API → Trading Engine → Trading Bot begins its tick loop (Bot Module 1, per `08_Bot_Architecture.md`).
3. **Bot trades automatically** — Bot's internal multi-agent loop runs (Modules 2–7), executing trades against the linked account per APIRS.
4. **Live activity streams to dashboard** — Bot emits trade/status events → Trading Engine → Backend API → WebSocket → Frontend Dashboard updates in real time (`NFR-3`, `FR-DASH-2`).
5. **Press "Stop Trading"** — reverse of step 2; Bot halts its tick loop cleanly.

## 5. Real-Time Update Architecture

- WebSocket connection established between Frontend and Backend API on login/dashboard load
- Backend API broadcasts: bot status changes, trade open/close events, equity updates, strategy switches (`FR-NOTIF-3`), circuit-breaker triggers (Bot Architecture Phase 5/6)
- Redis used as the pub/sub layer between the Trading Engine and the Backend API's WebSocket server, so multiple backend instances (if scaled horizontally) all see the same events

## 6. AI Integration Points (Two Separate Systems — Do Not Conflate)

Telos has **two distinct AI integration points**, and they must not be merged into one service:

1. **Bot-internal AI** (`08_Bot_Architecture.md` Modules 2–4) — used for market/news analysis and strategy confidence scoring, feeding into APIRS. Runs inside the Bot process, on the cadence to be defined in Bot Architecture's open items (Section 11 there).
2. **AI Assistant module** (`FR-AI-1`/`FR-AI-2`, user-facing) — a separate chat/insights feature the user interacts with directly from the Frontend. Calls the Backend API, which calls the AI provider (Claude/OpenAI) on request — not on a continuous tick loop, and with no path into APIRS or trade execution. Scope of what it's allowed to do (read-only insights vs. any ability to influence bot behavior) is still open per SRS `FR-AI-2`.

## 7. Security Boundaries (Enforced by This Architecture)

- Frontend ↔ Backend API: JWT-authenticated REST + WebSocket only
- Backend API ↔ Trading Engine ↔ Bot ↔ MT5/Broker: internal, never exposed to the Frontend or public internet directly
- Broker credentials: encrypted at rest in PostgreSQL, decrypted only within the Backend API/Trading Engine boundary, never sent to the Frontend
- No component other than the Bot (via the Trading Engine) may place trades — matches Blueprint Section 5 and AI Rules 6a

## 8. Deployment Architecture

- **Frontend** — deployed to Vercel, auto-deploys from GitHub (confirmed, per prior planning)
- **Backend API / Trading Engine / Bot / Database** — **self-hosted on your own PC**, not a cloud provider. This actually fits the Bot's nature well: it's a long-lived process (Section 3.4), which doesn't suit typical serverless platforms like Vercel anyway — an always-on machine is the right shape for it.
- **Connectivity — confirmed: Cloudflare Tunnel.** Connects the Vercel-hosted Frontend to the self-hosted Backend without opening ports on the router or needing a static IP/dynamic DNS. Also fits well with a mobile hotspot connection (see below), since it doesn't require an inbound-reachable public IP at all. Cloudflare's free tier covers this, which matters given no credit card is available for paid services.
- **Hardware reality check:** the PC running everything is an Intel Core i5-6300U @ 2.4GHz, 8GB RAM, 64-bit. That's modest for running Docker containers for the Backend API, PostgreSQL, Redis, and the Bot's multi-agent orchestration (Section 6) simultaneously, all day. Not a blocker, but worth keeping container resource limits tight and monitoring memory usage once real load is on it — 8GB fills up fast across four+ containers.
- **Connectivity source:** internet is via phone hotspot, not fixed broadband. Two implications: (1) data usage matters — WebSocket streaming and continuous market/news polling (Bot Architecture Section 9) run all day, so it's worth watching data caps/throttling; (2) hotspot connections are generally less stable than fixed broadband, which reinforces the uptime concern already flagged below.
- **Initial scale target — confirmed: 5 real users** on this exact setup (self-hosted PC + hotspot + Cloudflare Tunnel), rather than waiting to move to cloud hosting first. This gives a concrete near-term target instead of designing against the eventual "thousands of users" goal (Blueprint Section 9) from day one — cloud migration becomes relevant if/when growth approaches this setup's ceiling, not before.
- **Operational flags, not software decisions, but worth having a plan for:**
  - Forex markets run ~24/5 — the PC needs to stay powered on and connected almost continuously; a power or internet drop silently pauses the Bot. A UPS (battery backup) is worth having, especially with hotspot connectivity already being the less stable link.
  - Single machine = single point of failure. No automatic redundancy if the hardware fails (ties to `05_Database_Design.md` Section 4's backup/redundancy open item).

## 9. Open Items

- **Longer-term horizontal scaling plan for the Bot** — beyond the confirmed 5-user initial target (Section 8), and beyond the one-MT5-terminal-per-user model (Section 3.6): does each user eventually get an isolated Bot process, or does one Bot service manage many accounts? Only relevant once approaching that ceiling — the last genuinely open architectural question in this document.

**Settled:**
- ~~Backend/Bot/Database hosting provider~~ → self-hosted on your own PC (Section 8).
- ~~Tunnel/connectivity method~~ → Cloudflare Tunnel (Section 8).
- ~~Backup/redundancy plan~~ → scheduled encrypted `pg_dump` to a private GitHub repo (`05_Database_Design.md` Section 4).
- ~~All items previously carried from `08_Bot_Architecture.md`~~ → all resolved there (Section 13).
- ~~Initial scale target~~ → 5 real users on the self-hosted setup (Section 8).
- ~~MT5/broker connection method~~ → official `MetaTrader5` Python package, local Python service alongside the Node.js backend (Section 3.6).
- ~~Single vs. multi broker-account per user~~ → **Crypto Increment A:** DB `UNIQUE(user_id, broker_id)` landed (`broker_connections.broker_id`); API still single-connection (`409`) until a later crypto control-plane increment. Schema was never `UNIQUE(user_id)` at the DB — that was always app-enforced (Section 3.6 / CHANGELOG).

---

*Next: `05_Database_Design.md` will define the PostgreSQL/Redis schema referenced in Section 3.5.*