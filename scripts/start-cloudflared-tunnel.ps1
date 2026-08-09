# Named Cloudflare Tunnel → local Telos backend on 127.0.0.1:3000.
# Config/credentials live under %USERPROFILE%\.cloudflared (not the git repo).

$ErrorActionPreference = 'Stop'
$Cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$Config = Join-Path $env:USERPROFILE '.cloudflared\config.yml'

if (-not (Test-Path $Cloudflared)) {
  throw "cloudflared not found at $Cloudflared"
}
if (-not (Test-Path $Config)) {
  throw "Missing tunnel config: $Config - run named-tunnel setup first"
}

& $Cloudflared tunnel --config $Config run
