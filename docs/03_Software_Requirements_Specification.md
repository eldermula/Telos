# 03 — Software Requirements Specification (SRS) — Telos

> Read `MASTER_PROJECT_BLUEPRINT.md`, `01_Project_Vision.md`, and `02_Product_Requirements.md` first. This document turns PRD features into concrete, testable requirements. Requirement IDs (e.g. `FR-AUTH-1`) should be referenced in code comments/tests where relevant.

---

## 1. Purpose & Scope

This SRS covers the functional and non-functional requirements for all Telos modules defined in the PRD: Auth, Onboarding, Dashboard, Trading, Trading Bot, AI Assistant, Portfolio, Analytics, Reports, Notifications, Settings, Admin.

## 2. Definitions

- **Linked broker account** — a user's own existing brokerage account, connected to Telos via credentials/API keys, never custodied by Telos.
- **Trading Bot** — the automation component that executes trades through a linked broker account, per the architecture in Blueprint Section 5.
- **Strategy** — a defined trading approach/ruleset the bot can operate under.
- **Equity decline trend** — a sustained downward movement in account equity over a defined window, as opposed to normal short-term fluctuation (exact threshold TBD — see Section 8).

## 3. Functional Requirements

### 3.1 Auth
- `FR-AUTH-1` — Users can sign up with email/password.
- `FR-AUTH-2` — Users can log in and receive a JWT session token.
- `FR-AUTH-3` — Users can log out, invalidating the session.
- `FR-AUTH-4` — Users can reset a forgotten password via email flow.
- `FR-AUTH-5` — (Future) MFA support — scope to be confirmed.

### 3.2 Onboarding — Broker Account Linking
- `FR-ONB-1` — Users can link an existing broker account by submitting credentials/API keys through a form that transmits directly to the backend (never stored or processed client-side beyond the transmission itself).
- `FR-ONB-2` — Backend stores broker credentials encrypted at rest.
- `FR-ONB-3` — System validates the connection at link time and surfaces success/failure to the user.
- `FR-ONB-4` — Users can view current connection status (connected / disconnected / error) at any time.
- `FR-ONB-5` — Users can re-link or disconnect their broker account from Settings.
- `FR-ONB-6` — No deposit or withdrawal capability exists anywhere in the onboarding flow (Blueprint 5a).

### 3.3 Dashboard
- `FR-DASH-1` — Dashboard displays account/broker connection status, portfolio snapshot, and recent trading activity on load.
- `FR-DASH-2` — Dashboard updates key figures in real time (or near-real-time) while the bot is actively trading.

### 3.4 Trading
- `FR-TRADE-1` — User can start automated trading via a "Start Trading" control, which signals the backend to activate the Trading Bot on their linked account.
- `FR-TRADE-2` — User can stop automated trading at any time via a "Stop Trading" control.
- `FR-TRADE-3` — Current bot status (running / stopped / error) is visible at all times.
- `FR-TRADE-4` — User can view open positions, pending orders, and trade history.
- `FR-TRADE-5` — User can optionally place manual trades independent of the bot (manual trading view, per PRD 3.4).

### 3.5 Trading Bot
- `FR-BOT-1` — The bot integrates with an AI model (Claude API and/or OpenAI API) to analyze real-time market data as part of its decision-making process.
- `FR-BOT-2` — The bot maintains a set of candidate strategies, informed by established/recognized trading methodologies, rather than operating on a single hardcoded approach.
- `FR-BOT-3` — The bot can dynamically select or switch between candidate strategies based on real-time analysis rather than committing permanently to one strategy.
- `FR-BOT-4` — Rather than a fixed profit cap, the bot applies a **dynamic compounding profit-lock strategy** (milestone-based percentage split) while equity is trending favorably. See Section 3.5.1 for the full definition.
- `FR-BOT-5` — The bot continuously monitors account equity. When equity shows a declining trend (per the definition in Section 8, once finalized), the bot switches away from the profit-lock cadence in `FR-BOT-4` and either changes strategy or halts trading.

#### 3.5.1 Profit-Lock Strategy — Milestone-Based Percentage Split

Full detail — including the dynamic per-tier step sizes, risk-scaling matrix, and circuit breakers this strategy operates alongside — now lives in `08_Bot_Architecture.md` (the Adaptive Progressive Intelligence Risk System). Summary: while equity trends favorably, the bot locks in `lock_ratio` (70%) of profit at each completed milestone and continues compounding the remaining `growth_ratio` (30%). This is a de-risking mechanism only — no funds ever move out of the user's linked broker account, keeping it compliant with the non-custodial rule (Blueprint 5a).
- `FR-BOT-6` — Every strategy selection, switch, and stop/start decision is logged with a timestamp and the triggering condition, for audit and later review.
- `FR-BOT-7` — A hard maximum-drawdown safeguard exists independent of the day-to-day trend logic: a 45% drawdown from peak equity triggers an immediate strategy switch or full halt, plus a same-day micro circuit breaker (two consecutive losses, 15% daily drawdown, high volatility, or confidence below 80% all force position risk down to 1%). Full definition in `08_Bot_Architecture.md`.
- `FR-BOT-8` *(recommended, still not yet confirmed)* — New or modified strategies/tiers are backtested against historical data, and/or run in a paper-trading mode, before being enabled on a live linked account.

### 3.6 AI Assistant
- `FR-AI-1` — Users can interact with an in-app AI assistant for portfolio/trading insights.
- `FR-AI-2` — Scope of assistant actions (read-only commentary vs. ability to trigger bot actions) — TBD, see Section 8.

### 3.7 Portfolio
- `FR-PORT-1` — Portfolio view displays current holdings and performance sourced from the linked broker account via the backend.
- `FR-PORT-2` — Historical performance is viewable over selectable time ranges.

### 3.8 Analytics
- `FR-ANLY-1` — System surfaces performance metrics (exact metric set — win rate, drawdown, P&L over time, etc. — TBD, see Section 8).
- `FR-ANLY-2` — Business-level analytics available for firm/consultant use cases, distinct from individual trading metrics.

### 3.9 Reports
- `FR-REP-1` — Users can generate a report summarizing performance for a selected period.
- `FR-REP-2` — Reports are exportable (format TBD — PDF/CSV likely candidates).

### 3.10 Notifications
- `FR-NOTIF-1` — System notifies users of bot start/stop events.
- `FR-NOTIF-2` — System notifies users of connection errors or trading errors.
- `FR-NOTIF-3` — System notifies users when the bot switches strategy or halts due to an equity decline trend.

### 3.11 Settings
- `FR-SET-1` — Users can manage profile/account settings.
- `FR-SET-2` — Users can manage broker connection (re-link/disconnect).
- `FR-SET-3` — Users can manage notification preferences.

### 3.12 Admin
- `FR-ADMIN-1` — Admins can view user accounts and system health.
- `FR-ADMIN-2` — Admin functionality is not exposed to regular users.

## 4. Non-Functional Requirements

- `NFR-1` — **Non-custodial constraint**: no requirement in this document may be implemented in a way that involves Telos accepting, holding, or transferring user trading funds (Blueprint 5a). This overrides any conflicting interpretation of a feature above.
- `NFR-2` — **Security boundary**: broker credentials and API keys are handled only server-side, encrypted at rest, never exposed to the frontend (Blueprint Section 5, Section 5).
- `NFR-3` — **Real-time delivery**: trading activity, bot status, and equity updates reach the dashboard via WebSockets with low latency.
- `NFR-4` — **Responsiveness**: all user-facing modules function on both desktop and mobile-friendly layouts.
- `NFR-5` — **Scalability**: architecture should not block scaling toward thousands of concurrent users, even if not fully built for that scale on day one.
- `NFR-6` — **Auditability**: bot decisions (strategy selection, switches, stops) are logged in a way that supports later review and debugging (ties to `FR-BOT-6`).
- `NFR-7` — **Design consistency**: black/dark-gray background, gold accent (`#D4AF37`), glassmorphism, dark mode by default (per `07_UI_UX_Guide.md`).

## 5. External Interface Requirements

- **Broker / MT5 interface** — connection method TBD (Section 8); defines how the bot places trades on the user's linked account.
- **AI model interface** — Claude API and/or OpenAI API, used by the Trading Bot for real-time market analysis and strategy selection (`FR-BOT-1`–`FR-BOT-3`), and by the AI Assistant module (`FR-AI-1`).

## 6. Constraints

- Frontend must never call the trading engine, Trading Bot, MT5, or broker directly (Blueprint Section 5 / AI Rules 6a).
- No deposit/withdrawal or fund-custody functionality anywhere in the system (Blueprint Section 5a / AI Rules 6b).
- Approved technology stack only, per Blueprint Section 6, unless the Blueprint is updated first.

## 7. Assumptions & Dependencies

- The Trading Bot's core execution logic is a separate component, to be integrated via the backend API once provided (Blueprint Section 10, PRD Section 6).
- AI-driven strategy selection depends on availability and reliability of the chosen AI API (Claude/OpenAI) at runtime; a fallback behavior (e.g., pause trading, or revert to a default conservative strategy) should be defined once this integration is scoped in more detail.

## 8. Open Questions

**Settled** — all three now resolved in `08_Bot_Architecture.md`:
- ~~Candidate strategy set for `STRATEGY_A`~~ → Section 13 (MA crossover, breakout, RSI mean-reversion starter set).
- ~~Penalty parameter formulas~~ → Section 4.
- ~~`FR-BOT-8` backtesting/paper-trading gate~~ → Section 11, confirmed adopted.

---

*Next: `04_System_Architecture.md` will diagram how these requirements map onto the frontend/backend/bot/database components.*