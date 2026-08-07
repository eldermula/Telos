# Frontend — Vercel Deployment

Per `docs/04_System_Architecture.md` §8: the Frontend deploys to Vercel;
the self-hosted Backend (this PC) stays reachable through a Cloudflare
Tunnel. This doc covers the Frontend side only.

## Repo config already in place

- `vercel.json` — SPA rewrite (`/* -> /index.html`) so client-side routes
  (`/trading`, `/onboarding/broker`, etc.) don't 404 on a hard refresh or
  direct link. Build command `npm run build`, output `dist/`.
- Root directory for the Vercel project must be set to `frontend/` (this
  is a monorepo — `backend/`, `bot/`, `frontend/` are siblings).

## One-time manual setup (needs your own Vercel + Cloudflare accounts)

These steps require interactive login and account-specific credentials,
so they're not something that can be scripted here — do them once from
your machine:

1. `npm i -g vercel` (or use the Vercel web dashboard's "Import Project"
   flow directly from the GitHub repo instead of the CLI).
2. `vercel link` from `frontend/` (or import via dashboard), selecting
   this repo and setting **Root Directory = `frontend`**.
3. Start a Cloudflare Tunnel on the backend PC pointed at the Backend API
   (port 3000) and the WebSocket server (same port, `/ws` path — one
   tunnel hostname covers both since they share a port). This gives you
   a stable `https://<subdomain>.trycloudflare.com` (quick tunnel) or a
   named tunnel hostname on your own domain if you've added one to
   Cloudflare.
4. In the Vercel project's **Settings → Environment Variables**, set:
   - `VITE_API_BASE_URL` = `https://<your-tunnel-hostname>/api/v1`
   - `VITE_WS_BASE_URL` = `wss://<your-tunnel-hostname>`
5. Trigger a deploy (push to the connected branch, or `vercel --prod`).

## Local dev vs. production env

`frontend/.env.example` still documents the local defaults
(`http://localhost:3000` / `ws://localhost:3000`) for running the
Backend and Frontend on the same machine during development — leave
that file as-is. Production values only ever live in Vercel's
environment variable settings, never committed to the repo.

## Not yet done

The Cloudflare Tunnel itself (step 3 above) has not been stood up yet —
today's smoke tests run the Frontend and Backend on `localhost` on the
same machine. Standing up the tunnel and doing the first real Vercel
deploy needs you to run the interactive steps above; ping when ready to
do that together, or if you'd rather Cloudflare Tunnel be scripted as
part of the Backend's Docker Compose stack (`04_System_Architecture.md`
already anticipates this), say so and it can be added there.
