# Production-facing Telos backend (Vercel frontend → Cloudflare Tunnel → :3000).
# Overrides .env NODE_ENV so access-gate cookies are SameSite=None; Secure.
# REAL_TRADING_ALLOW_DEMO must stay unset (E.0 production tripwire).

$ErrorActionPreference = 'Stop'
$BackendDir = Join-Path $PSScriptRoot '..\backend' | Resolve-Path

$env:NODE_ENV = 'production'
$env:CORS_ORIGIN = 'https://www.telostrust.com'
# Clear leftover shell exports. dotenv still loads any of these if they are
# still present (uncommented) in backend/.env — keep them absent there for
# production boots or assertRealTradingDemoBypassAtStartup will refuse.
Remove-Item Env:\REAL_TRADING_ALLOW_DEMO -ErrorAction SilentlyContinue
Remove-Item Env:\SYNTHETIC_ALLOW_MANUAL_TEST_TRADE -ErrorAction SilentlyContinue
# Retired env bypasses (now admin DB toggles) — clear leftovers so they
# cannot linger in a shell that still exports them.
Remove-Item Env:\SYNTHETIC_ALLOW_DEMO_CONFIRM -ErrorAction SilentlyContinue
Remove-Item Env:\SYNTHETIC_REAL_TRADING_ALLOW_DEMO -ErrorAction SilentlyContinue

Set-Location $BackendDir
& node src/index.js
