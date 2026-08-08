# Production-facing Telos backend (Vercel frontend → Cloudflare Tunnel → :3000).
# Overrides .env NODE_ENV so access-gate cookies are SameSite=None; Secure.
# REAL_TRADING_ALLOW_DEMO must stay unset (E.0 production tripwire).

$ErrorActionPreference = 'Stop'
$BackendDir = Join-Path $PSScriptRoot '..\backend' | Resolve-Path

$env:NODE_ENV = 'production'
$env:CORS_ORIGIN = 'https://www.telostrust.com'
Remove-Item Env:\REAL_TRADING_ALLOW_DEMO -ErrorAction SilentlyContinue

Set-Location $BackendDir
& node src/index.js
