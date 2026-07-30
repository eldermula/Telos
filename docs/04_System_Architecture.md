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
                      │   MT5 / Broker API  │  (user's own linked
                      │                      │   broker account)
                      └─────────┬──────────┘
                                │
                                ▼
                           [ Markets ]
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
- The user's own linked broker account (Blueprint 5a — non-custodial)
- Connection method (MT5 API vs. broker-specific API) is still an open item — see Section 8

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
- **Backend API / Trading Engine / Bot / Database** — hosting provider not yet decided. Blueprint Section 6 confirms Docker as the containerization approach, but not where those containers run (e.g. a VPS, a managed container service, etc.). This matters more than it might seem: the Bot is a long-lived process, not a typical serverless request handler, so the hosting choice needs to support that.

## 9. Open Items

- **Backend/Bot/Database hosting provider** — not yet chosen (Section 8).
- **MT5/broker connection method** — carried over from PRD Section 7 / SRS Section 8.
- **Horizontal scaling plan for the Bot** — if a user base grows to "thousands of concurrent users" (Blueprint Section 9), does each user get an isolated Bot process, or does one Bot service manage many accounts? Not yet defined, and it changes the Trading Engine's design meaningfully.
- All six open items still pending in `08_Bot_Architecture.md` (Strategy B, fallback defaults, AI cadence, data payload structure, backtesting policy, News-source reliability) feed directly into this document once resolved.

---

*Next: `05_Database_Design.md` will define the PostgreSQL/Redis schema referenced in Section 3.5.*