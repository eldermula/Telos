# Telos — Agent Rules

Read this before touching any code. When in doubt, stop and ask rather than guess.

## Project

Telos: self-hosted, non-custodial automated trading platform (forex/gold, crypto,
synthetics/Volatility Indices) via Deriv MT5. Node.js/Express backend, React/TS/Vite
frontend, PostgreSQL + Redis, Python MT5 connector. Deployed: frontend on Vercel,
backend self-hosted behind Cloudflare Tunnel.

## Non-negotiable rules

- **Frontend never calls the trading engine, MT5, or the broker directly.** Always:
  Frontend → Backend API → Trading Engine → Bot → MT5 → Broker.
- **Non-custodial.** Never build deposit/withdrawal or fund-custody functionality.
  Users link their own broker account; Telos never holds their funds.
- **Approved stack only**: Node/Express/PostgreSQL/Redis/WebSockets backend,
  React/TypeScript/Vite/Tailwind frontend, Python only for the MT5 connector.
  No new framework, DB, or hosting provider without flagging it first.
- **One open position per user, system-wide, across ALL asset classes**
  (forex/crypto/synthetic) — enforced by a partial unique DB index
  (`one_open_trade_per_user` on `trades(user_id) WHERE status='open'`). This is
  deliberate correlation-risk protection, not a leftover default. Never relax,
  bypass, or work around it without explicit owner approval — this has already
  been broken once by accident and had to be reverted.
- **Real-money/real-order code is the highest-risk code in this project.** Never
  batch changes to sizing math, dispatch logic, and live verification into one
  step. Build and test in isolation; prove live behavior as its own explicit,
  separate step with real evidence (raw logs, raw DB rows, raw broker responses)
  — never a summary or an assumption.

## Testing-bypass infrastructure

- Demo-account testing bypasses (confirm-live, real-dispatch, manual-trigger) are
  **DB-backed, admin-JWT-gated, 30-minute max, auto-expiring toggles** — never raw
  env vars. This pattern exists because a raw env var was once left live on
  production for hours across restarts. Do not reintroduce env-var-based bypasses.
- Every write under `/admin/*` must log to `admin_audit_log` (admin_user_id,
  action, target, timestamp) — this is a documented API requirement, check it's
  covered for anything new.
- Manual test-dispatch trades are marked `trades.origin = 'manual'` (already a
  documented enum value) — never conflate them with genuine strategy-selected
  trades in logs or history.

## Operational hygiene

- Restart the backend with `scripts/start-telos-backend.ps1`, never plain
  `node src/index.js` — plain node has previously left production silently
  running in `development` mode with the wrong CORS origin, and once with
  demo-testing flags live that should have been blocked.
- After any change: confirm `NODE_ENV=production` on the actual running process,
  don't assume it from the code alone.
- Every task ends with: run tests, commit, push, and log a real entry to
  `docs/CHANGELOG.md` — this project has a git hook guarding against the
  CHANGELOG going empty or shrinking; don't skip logging changes into it.
- Don't touch files/logic unrelated to the current task. Don't add dependencies
  or new packages silently — flag the addition and reason first.
- Halt (blocks new position-opens only) is intentionally separate from Stop
  (halts everything, including monitoring of an already-open position) — for
  both forex and synthetics. Don't merge these two behaviors back together.
- Risk ceilings (e.g. `REAL_MAX_LOT`) are deliberate product decisions. Never
  raise, lower, or bypass one without an explicit instruction to do so.

## Working style

- Explain what you're about to change and why before applying anything
  structural (new files, new dependencies, schema changes). Wait for approval.
- Report raw evidence (logs, query results, HTTP responses), not summaries,
  especially for anything involving real orders, migrations, or admin routes.
- If a request conflicts with something documented in `docs/` or with anything
  above, flag the conflict explicitly rather than resolving it silently.
