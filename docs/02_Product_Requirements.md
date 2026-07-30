# 02 — Product Requirements Document (PRD) — Telos

> Read `MASTER_PROJECT_BLUEPRINT.md` and `01_Project_Vision.md` first. This document defines *what* Telos must do. `03_Software_Requirements_Specification.md` will define the more granular technical requirements per module.

---

## 1. Overview

Telos is a SaaS dashboard combining automated trading (via a linked broker account and a Trading Bot component), AI assistance, analytics, reporting, and business workflow tools — delivered as a premium, enterprise-grade product.

## 2. Target Users / Personas

| Persona | Primary need |
|---|---|
| Individual trader | Automated execution on their own broker account, with visibility into performance |
| Investment firm staff | Multi-account/portfolio oversight, reporting for stakeholders |
| Business owner | Analytics + workflow automation alongside trading tools |
| Financial consultant | Client-facing reports, professional presentation |
| AI-automation company | A polished front end/dashboard layer for automated systems |

## 3. Core Features by Module

### 3.1 Auth
- Sign up / log in / log out
- JWT-based session handling
- Password reset
- (Future) MFA support

### 3.2 Onboarding — Broker Account Linking
- User links their existing broker account (credentials/API keys captured and handled only by the backend — never exposed to or stored in the frontend)
- Connection status clearly shown (connected / disconnected / error)
- No deposit or withdrawal flow of any kind is part of onboarding — linking is the only step (per Blueprint Section 5a)

### 3.3 Dashboard
- Central summary view: account status, portfolio snapshot, recent activity, key metrics
- Entry point to all other modules

### 3.4 Trading
- **Start Trading** control — begins automated execution via the Trading Bot through the linked broker account
- **Stop Trading** control — halts automated execution
- Manual trading views: current positions, open orders, trade history
- Live status of the bot (running / stopped / error)

### 3.5 Trading Bot (integration point)
- Existing/separate component — Telos integrates with it via the backend API, not the frontend
- Backend is responsible for relaying Start/Stop commands and receiving trade execution data back
- Full behavior spec lives in `08_Bot_Architecture.md`

### 3.6 AI Assistant
- In-app AI chat and/or insights surfaced contextually (e.g., portfolio commentary, anomaly flags)
- Scope of what the assistant can *do* (read-only insights vs. taking actions) to be defined in `03_SRS.md`

### 3.7 Portfolio
- Holdings, performance over time, historical view
- Data sourced from the linked broker account via the backend, not entered manually

### 3.8 Analytics
- Charts and metrics on trading performance (win rate, drawdown, P&L over time, etc. — exact metric set TBD in SRS)
- Business-level analytics for firms/consultants using Telos beyond individual trading

### 3.9 Reports
- Generated and exportable reports (e.g., PDF/CSV) summarizing performance for a given period
- Useful for consultants/firms presenting to clients or stakeholders

### 3.10 Notifications
- System alerts (bot started/stopped, errors, connection issues)
- Trading-related alerts (as defined in SRS/Bot Architecture)

### 3.11 Settings
- Account/profile settings
- Broker connection management (re-link, disconnect)
- Notification preferences

### 3.12 Admin
- Internal oversight: user accounts, system health, support tooling
- Not customer-facing

## 4. Non-Functional Requirements

- **Non-custodial at all times** — no feature may accept, hold, or transfer user trading funds (Blueprint 5a). This is a hard requirement, not a phase-one limitation to be revisited later.
- **Security** — broker credentials/API keys handled only server-side, encrypted at rest; frontend never has direct access to broker/MT5/trading engine (Blueprint Section 5).
- **Real-time updates** — live trading activity and status must reach the dashboard via WebSockets with low latency.
- **Responsive** — full functionality on desktop and mobile-friendly layouts.
- **Scalability** — architecture should reasonably scale toward thousands of concurrent users (doesn't need to be fully built for that scale on day one, but shouldn't be architected in a way that blocks it).
- **Design consistency** — black/dark-gray background, gold accent (`#D4AF37`), glassmorphism, dark mode by default, per the UI/UX Guide.

## 5. Explicitly Out of Scope

- Any deposit/withdrawal handling of user trading funds
- Telos acting as a broker or counterparty
- Manual signal/tip-sharing as the primary product (manual trading views exist, but automation via the bot is the core value)

## 6. Dependencies

- **Trading Bot component** — built separately, integrates via backend API. Full spec pending in `08_Bot_Architecture.md` once provided.
- **Broker/MT5 connectivity** — specifics (which broker(s), which API/protocol) to be confirmed and documented in `04_System_Architecture.md` / `08_Bot_Architecture.md`.

## 7. Open Questions (to resolve before/alongside SRS)

- Which broker(s) are supported first, and via what connection method (MT5 API, broker-specific API, etc.)?
- Subscription/billing model for the Telos platform itself (separate from trading funds) — is there one, and what does it look like?
- Exact analytics metrics to surface (win rate, Sharpe ratio, drawdown, etc.)
- MFA and other security requirements for Auth beyond basic JWT

---

*Next: `03_Software_Requirements_Specification.md` turns these features into concrete functional/technical requirements per module.*