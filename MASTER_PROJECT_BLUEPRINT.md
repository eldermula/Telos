# MASTER PROJECT BLUEPRINT — Telos

> **Read this file before making any changes to the project.**
> This is the single source of truth for what Telos is, who it's for, how it's built, and what must never change without explicit approval. Every AI tool (Cursor, Claude, ChatGPT, Windsurf, Gemini) reads this first.

---

## 1. What We're Building

**Telos** is a premium, enterprise-grade SaaS platform that combines:

- AI-powered assistance
- Automated trading (via a separate Trading Bot component, connected to MT5)
- Business automation
- Analytics and reporting
- Workflow management

All of this lives in a single, unified dashboard. Telos is not a demo or MVP throwaway — it's being built like a real, scalable software product from day one.

## 2. Who It's For

- Individual traders
- Investment firms
- Business owners
- Financial consultants
- AI-automation companies
- Organizations that need analytics/reporting tooling

## 3. Design Direction

Telos should feel **luxury, professional, and enterprise-grade** — think private banking software, not a retail trading app.

- **Background:** black / dark-gray
- **Accent color:** gold — `#D4AF37`
- **Style:** glassmorphism, rounded cards, generous spacing, restrained motion
- **Mode:** dark mode by default, fully responsive (desktop + mobile)

Full detail lives in `docs/06_UI_UX_Guide.md` — this section is the summary every AI should internalize before writing any UI code.

## 4. Core Modules

| Module | Purpose |
|---|---|
| Auth | Sign up / login / sessions, JWT-based |
| Dashboard | Central hub, summary widgets |
| Trading | Manual trading views, positions, orders |
| Trading Bot | Separate existing component — automated trading logic, integrates via API |
| AI Assistant | In-app AI chat / insights |
| Portfolio | Holdings, performance, history |
| Analytics | Charts, metrics, performance breakdowns |
| Reports | Generated/exportable reports |
| Notifications | Alerts, system messages |
| Settings | User + account preferences |
| Admin | Internal management, user oversight |

## 5. Critical Architecture Rule (Non-Negotiable)

**The frontend must never execute trades directly.**

The only permitted trade flow is:

```
Frontend → Backend API → Trading Engine → Trading Bot → MT5 → Broker → Markets
```

No AI tool may add a code path that lets the frontend call MT5, the broker, or the trading engine directly. This is a security and correctness boundary, not a style preference. Any implementation that violates this must be flagged and rejected.

## 5a. Custody Model (Non-Negotiable)

**Telos is non-custodial.** Users connect their own existing broker account (credentials/API keys), and Telos's Trading Bot executes trades on their behalf through that account.

- Telos does **not** accept deposits or withdrawals of user trading funds.
- Telos does **not** custody, hold, or take possession of user funds at any point.
- All money movement (deposits, withdrawals, funding) happens directly between the user and their own broker — outside Telos entirely.

This has direct implications for security and scope: no code path should be built for accepting, holding, or transferring user trading funds. (Subscription/billing for the Telos platform itself, if introduced later, is a separate concern from custody of trading funds and must not be conflated with it.)

## 5b. Core User Flow

1. User signs up / logs into Telos.
2. User links their existing broker account (credentials handled securely by the backend — never exposed to or handled by the frontend directly).
3. User presses **"Start Trading."**
4. The Trading Bot begins executing trades automatically through the linked broker account, following the architecture in Section 5.
5. Live trading activity streams to the Telos dashboard in real time (via WebSockets) so the user can watch performance as it happens.

## 6. Approved Technology Stack

**Backend**
- Node.js + Express
- REST API
- JWT authentication
- PostgreSQL
- Redis
- WebSockets (for live data/notifications)
- Docker
- Cloud deployment

**Frontend**
- React + TypeScript
- Vite
- Tailwind CSS (or equivalent utility-first styling)
- Fully responsive, dark mode by default
- Reusable, componentized architecture

**Infrastructure / Tooling**
- Git + GitHub (version control, source of truth for code)
- GitHub Desktop (local Git client)
- Vercel (deployment)

No AI tool should introduce a different core framework, database, or hosting provider without this document being updated first.

## 7. Top-Level Project Structure

```
Telos/
├── frontend/
├── backend/
├── bot/
├── database/
├── docs/
├── assets/
├── api/
├── tests/
├── MASTER_PROJECT_BLUEPRINT.md
├── README.md
└── .gitignore
```

`docs/` contains the full documentation set (Vision, PRD, SRS, Architecture, Database Design, API Spec, UI/UX Guide, Bot Architecture, Security, Roadmap, AI Rules, AI Prompt Library, Changelog).

## 8. The Multi-AI Workflow

Telos is built using multiple AI tools, each with a defined role — not overlapping, ad-hoc usage:

| Tool | Role |
|---|---|
| **ChatGPT** | Product architect, project planner, documentation writer, mentor |
| **Cursor** | Main implementation tool — writes/edits code in the actual project |
| **Windsurf** | Backup implementation tool when Cursor's free quota is exhausted |
| **Claude** | Specialist reviewer — complex trading logic, debugging, architecture critique |
| **Gemini** | Suggests improvements, second-opinion review |

**The rule that keeps this from becoming chaos:** no AI makes independent architecture or design decisions. Every tool reads this Blueprint and `docs/10_AI_Rules.md` first. Disagreements or proposed changes get raised, not silently implemented.

**Working rhythm:**
1. ChatGPT plans a feature
2. Cursor (or Windsurf, if quota-limited) builds it
3. Changes are committed via GitHub Desktop → GitHub
4. Vercel deploys automatically
5. Claude reviews the implementation (correctness, trading logic, security)
6. Gemini offers a second-opinion pass

Commit frequently. Git history is the safety net if any tool makes an unwanted change.

## 9. Long-Term Product Goals

Telos should eventually support:

- Full user accounts
- Live MT5 trading via linked broker accounts (non-custodial — see Section 5a)
- The AI trading bot (automated strategies)
- Trading analytics
- A mobile-friendly dashboard
- A full admin panel
- Thousands of concurrent users

*(Note: an earlier draft of this goal list included "deposits & withdrawals" of user trading funds — that has been superseded by the confirmed non-custodial model in Section 5a and removed to avoid contradiction.)*

## 10. Current Status

- ✅ GitHub repository created (`README.md`, `.gitignore` in place)
- ✅ Repository connected to Cursor via GitHub Desktop
- ⏳ Project folder/doc structure — not yet created
- ⏳ Trading Bot component — to be provided separately, integrated once backend API contract is defined
- ⏳ No application code written yet (by design — structure and docs come first)

---

*This document is the top-level summary. Detailed specs live in `docs/`. If anything here conflicts with a doc in `docs/`, this Blueprint wins until both are reconciled — flag the conflict rather than picking one silently.*
