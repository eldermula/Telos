# AI Rules — Telos Project Constitution

> Every AI tool (Cursor, Claude, ChatGPT, Windsurf, Gemini) must read this file before creating or modifying anything in this project. When in doubt, stop and ask rather than guess.

---

## 1. Project Goal (one line)

Build **Telos**, a premium AI + automated-trading + business-automation SaaS platform, as a real, production-grade product — not a prototype.

## 2. Approved Technologies

**Do not introduce alternatives to these without updating `MASTER_PROJECT_BLUEPRINT.md` first:**

- Backend: Node.js, Express, REST, JWT, PostgreSQL, Redis, WebSockets, Docker
- Frontend: React, TypeScript, Vite, Tailwind CSS
- Version control / deploy: Git, GitHub, Vercel

No new frameworks, databases, ORMs, or hosting providers may be added unilaterally.

## 3. Folder Structure (do not restructure without approval)

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
```

Files belong in their designated folder. Don't create new top-level folders without flagging it first.

## 4. Naming Conventions

- Files/folders: `kebab-case` for directories, standard per-language convention for code (`camelCase` for JS/TS variables and functions, `PascalCase` for React components and classes)
- Docs in `docs/` keep their numbered prefix (`01_`, `02_`, etc.) — never renumber existing docs; append new ones at the next available number
- Environment variables: `UPPER_SNAKE_CASE`

## 5. UI / Design Rules

- Background: black / dark-gray
- Accent: gold — `#D4AF37`
- Style: glassmorphism, rounded cards
- Dark mode by default, fully responsive
- Tone: luxury, professional, enterprise-grade — never playful, cluttered, or "startup-generic"

Full spec: `docs/06_UI_UX_Guide.md`.

## 6. The Rules That Cannot Be Broken

**6a. The frontend must never call the trading engine, the Trading Bot, MT5, or the broker directly.**

Required flow, always:

```
Frontend → Backend API → Trading Engine → Trading Bot → MT5 → Broker → Markets
```

Any code that lets the frontend bypass the backend for trade execution is a critical bug, not a shortcut. Reject it immediately, regardless of which AI wrote it.

**6b. Telos is non-custodial. Never build deposit/withdrawal or fund-custody functionality.**

Users link their own existing broker account; Telos trades through it but never accepts, holds, or transfers user trading funds. Any feature branch, endpoint, or UI screen that resembles a "deposit," "withdraw," or "fund your account" flow for trading capital is out of scope and must be flagged, not implemented. (Platform subscription billing, if it exists, is a separate and unrelated concern — don't let the two get conflated in code or docs.)

**Core user flow to keep in mind when building Auth, Dashboard, and Trading modules:** link broker account → press "Start Trading" → bot trades automatically → live activity streams to dashboard via WebSockets.

## 7. Coding Standards

- TypeScript on the frontend — no plain JS in new frontend code
- Components should be small, reusable, and composed rather than monolithic
- Backend routes follow REST conventions; no ad-hoc endpoint naming
- All secrets/config via environment variables — never hardcoded
- Every new feature that touches trading logic needs a corresponding test in `tests/`

## 8. Git Workflow

- Commit frequently, in small logical chunks
- Write descriptive commit messages (what changed and why, not just "update")
- Do not force-push over shared history
- Log meaningful changes in `docs/CHANGELOG.md`

## 9. Rules for Creating or Modifying Files

- **Explain before applying.** State what you're about to create/change and why. Wait for approval before large or structural changes.
- **Don't modify unrelated files.** If asked to implement Feature X, touch only what Feature X requires.
- **Don't install packages or add dependencies silently** — flag the addition and the reason.
- **Don't delete or overwrite existing docs in `docs/`** without explicit instruction.

## 10. What AI Must Never Do

- Never let the frontend execute trades directly (see Rule 6).
- Never introduce a new core technology (framework, DB, hosting) without updating the Blueprint first.
- Never restructure top-level folders unilaterally.
- Never hardcode secrets, API keys, or credentials.
- Never silently change the design system (colors, style direction) established in Section 5.
- Never assume approval for large refactors — ask first.

---

*If any instruction elsewhere conflicts with this file, this file wins. Flag the conflict rather than resolving it silently.*