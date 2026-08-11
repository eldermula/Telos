# Telos - single-shot local stack orchestrator.
#
# Replaces the fragile manual multi-window process (Docker Desktop, then
# "docker compose up", then the MT5 connector window, then the Cloudflare
# tunnel window, then the backend window - each started by hand with no
# real health check that the previous one actually came up) with one
# script that starts each piece in order and waits for evidence it is
# actually healthy before moving to the next.
#
# Orchestration only: this script does not modify any of the services it
# starts (backend/, bot/, docker-compose.yml, the tunnel config). It
# calls existing launchers (scripts/start-telos-backend.ps1,
# scripts/start-cloudflared-tunnel.ps1) and existing health endpoints.
#
# Scope note: "docker compose up -d postgres redis" is deliberately
# scoped to exactly those two services. docker-compose.yml also defines
# a "backend" service (a Docker image build) that this project does not
# actually run day-to-day - the real backend runs as a plain Node
# process via scripts/start-telos-backend.ps1. A previous session lost
# time to Docker attempting to build that unused image; this script
# never references the "backend" compose service, by name, anywhere.
#
# Usage (from repo root or anywhere):
#   powershell -File scripts/start-everything.ps1

$ErrorActionPreference = 'Continue'

$RepoRoot = (Join-Path $PSScriptRoot '..' | Resolve-Path).Path
$BackendHealthUrl = 'http://127.0.0.1:3000/health'
$Mt5HealthUrl = 'http://127.0.0.1:3100/health'
$Mt5AccountInfoUrl = 'http://127.0.0.1:3100/account-info'
$TunnelHealthUrl = 'https://api.telostrust.com/health'
$Mt5ServerScript = Join-Path $RepoRoot 'bot\mt5-connector\server.py'
$BackendLauncher = Join-Path $RepoRoot 'scripts\start-telos-backend.ps1'
$TunnelLauncher = Join-Path $RepoRoot 'scripts\start-cloudflared-tunnel.ps1'

# One row per top-level service in the final summary (step 8).
$Summary = [ordered]@{
  'Docker stack (Postgres + Redis)' = [ordered]@{ Status = 'not attempted'; Detail = '' }
  'MT5 connector'                   = [ordered]@{ Status = 'not attempted'; Detail = '' }
  'Cloudflare tunnel'               = [ordered]@{ Status = 'not attempted'; Detail = '' }
  'Backend'                         = [ordered]@{ Status = 'not attempted'; Detail = '' }
}

function Write-StepHeader {
  param([string]$Text)
  Write-Host ''
  Write-Host ('=== ' + $Text + ' ===') -ForegroundColor Cyan
}

function Write-Ok {
  param([string]$Text)
  Write-Host ('  [OK] ' + $Text) -ForegroundColor Green
}

function Write-WarnLine {
  param([string]$Text)
  Write-Host ('  [WARN] ' + $Text) -ForegroundColor Yellow
}

function Write-FailLine {
  param([string]$Text)
  Write-Host ('  [FAIL] ' + $Text) -ForegroundColor Red
}

# Generic "keep trying until true or timeout" loop. Test is a
# scriptblock returning $true/$false; it is responsible for its own
# per-attempt timeout so one slow call can't silently eat the whole
# budget (see Test-DockerReady below for why that matters).
function Wait-Until {
  param(
    [scriptblock]$Test,
    [int]$TimeoutSec,
    [int]$IntervalSec = 2
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    if (& $Test) { return $true }
    if ((Get-Date) -ge $deadline) { return $false }
    Start-Sleep -Seconds $IntervalSec
  } while ($true)
}

# Invoke-RestMethod throws on non-2xx; normalize success/failure into one
# shape so callers don't need try/catch at every call site. Works on both
# Windows PowerShell 5.1 and PowerShell 7 (no -SkipHttpErrorCheck needed).
function Get-JsonSafely {
  param(
    [string]$Uri,
    [int]$TimeoutSec = 5
  )
  try {
    $body = Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec $TimeoutSec -ErrorAction Stop
    return [PSCustomObject]@{ Success = $true; Body = $body; Message = $null }
  } catch {
    $parsedBody = $null
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      try { $parsedBody = $_.ErrorDetails.Message | ConvertFrom-Json } catch { $parsedBody = $_.ErrorDetails.Message }
    }
    return [PSCustomObject]@{ Success = $false; Body = $parsedBody; Message = $_.Exception.Message }
  }
}

# "docker info" against a Docker Desktop that has not finished booting can
# hang far longer than any reasonable per-attempt wait (observed: still
# running after 2+ minutes). Run it as a background job with its own
# short timeout so the outer 60s budget is actually respected.
function Test-DockerReady {
  param([int]$PerCallTimeoutSec = 5)
  $job = Start-Job -ScriptBlock { docker info *> $null; $LASTEXITCODE }
  $finished = Wait-Job -Job $job -Timeout $PerCallTimeoutSec
  if (-not $finished) {
    Stop-Job -Job $job -ErrorAction SilentlyContinue | Out-Null
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue | Out-Null
    return $false
  }
  $exitCode = Receive-Job -Job $job
  Remove-Job -Job $job -Force -ErrorAction SilentlyContinue | Out-Null
  return ($exitCode -eq 0)
}

function Start-LabeledWindow {
  param(
    [string]$Title,
    [string]$Command
  )
  $wrapped = '$host.UI.RawUI.WindowTitle = ' + "'" + $Title + "'" + '; ' + $Command
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-Command', $wrapped) -WindowStyle Normal | Out-Null
}

# ---------------------------------------------------------------------
# Step 1 - Docker Desktop
# ---------------------------------------------------------------------
Write-StepHeader 'Step 1/7: Waiting for Docker Desktop'
$dockerReady = Wait-Until -TimeoutSec 60 -IntervalSec 2 -Test { Test-DockerReady -PerCallTimeoutSec 5 }

if (-not $dockerReady) {
  Write-FailLine 'Docker Desktop did not respond within 60s.'
  Write-Host ''
  Write-Host 'Open Docker Desktop manually, wait until it shows "Engine running", then re-run this script:' -ForegroundColor Red
  Write-Host ('  powershell -File "' + $MyInvocation.MyCommand.Path + '"') -ForegroundColor Red
  $Summary['Docker stack (Postgres + Redis)'].Status = 'FAILED'
  $Summary['Docker stack (Postgres + Redis)'].Detail = 'Docker Desktop engine never responded to docker info.'
  $Summary['MT5 connector'].Detail = 'not attempted - Docker gate failed'
  $Summary['Cloudflare tunnel'].Detail = 'not attempted - Docker gate failed'
  $Summary['Backend'].Detail = 'not attempted - Docker gate failed'
  # Nothing downstream can meaningfully succeed without Postgres/Redis
  # (the backend needs both) - stop here rather than spawn windows that
  # are guaranteed to fail confusingly.
  Write-StepHeader 'Final summary'
  foreach ($name in $Summary.Keys) {
    $row = $Summary[$name]
    $tag = if ($row.Status -eq 'FAILED') { '[FAIL]' } elseif ($row.Status -eq 'not attempted') { '[SKIP]' } else { '[ OK ]' }
    Write-Host ("  {0} {1,-32} {2}" -f $tag, $name, $row.Detail)
  }
  exit 1
}
Write-Ok 'Docker Desktop engine is responding.'

# ---------------------------------------------------------------------
# Step 2 - docker compose up, scoped to postgres + redis only
# ---------------------------------------------------------------------
Write-StepHeader 'Step 2/7: Starting Postgres + Redis containers (scoped - not touching the backend image)'
Push-Location $RepoRoot
try {
  docker compose up -d postgres redis
  $composeExit = $LASTEXITCODE
} finally {
  Pop-Location
}

if ($composeExit -ne 0) {
  Write-FailLine ('docker compose up -d postgres redis exited with code ' + $composeExit + '.')
  $Summary['Docker stack (Postgres + Redis)'].Status = 'FAILED'
  $Summary['Docker stack (Postgres + Redis)'].Detail = 'docker compose exited ' + $composeExit + " - run 'docker compose logs postgres redis' from " + $RepoRoot
} else {
  Write-Ok 'docker compose up -d postgres redis succeeded.'
}

# ---------------------------------------------------------------------
# Step 3 - Redis ping
# ---------------------------------------------------------------------
Write-StepHeader 'Step 3/7: Waiting for Redis to answer PING'
Push-Location $RepoRoot
$redisReady = Wait-Until -TimeoutSec 30 -IntervalSec 2 -Test {
  $pong = (docker compose exec -T redis redis-cli ping 2>$null | Out-String).Trim()
  $pong -eq 'PONG'
}
Pop-Location

if ($redisReady) {
  Write-Ok 'Redis answered PONG.'
  if ($Summary['Docker stack (Postgres + Redis)'].Status -ne 'FAILED') {
    $Summary['Docker stack (Postgres + Redis)'].Status = 'HEALTHY'
    $Summary['Docker stack (Postgres + Redis)'].Detail = 'postgres + redis containers up, redis PING -> PONG'
  }
} else {
  Write-FailLine 'Redis did not answer PING within 30s.'
  $Summary['Docker stack (Postgres + Redis)'].Status = 'FAILED'
  $Summary['Docker stack (Postgres + Redis)'].Detail = "Redis container up but not answering PING - check 'docker compose logs redis' from " + $RepoRoot
}

# ---------------------------------------------------------------------
# Step 4 - MT5 connector
# ---------------------------------------------------------------------
Write-StepHeader 'Step 4/7: Starting the MT5 connector'

$mt5AlreadyUp = Get-JsonSafely -Uri $Mt5HealthUrl -TimeoutSec 3
if ($mt5AlreadyUp.Success -and $mt5AlreadyUp.Body.status -eq 'ok') {
  Write-Ok 'MT5 connector is already running and healthy - not spawning a duplicate window.'
} else {
  if (-not (Test-Path $Mt5ServerScript)) {
    Write-FailLine ('MT5 connector script not found at ' + $Mt5ServerScript)
  } else {
    $mt5Command = "Set-Location '" + $RepoRoot + "'; python '" + $Mt5ServerScript + "'"
    Start-LabeledWindow -Title 'Telos - MT5 Connector' -Command $mt5Command
    Write-Host '  spawned window: Telos - MT5 Connector'
  }
}

$mt5Ready = Wait-Until -TimeoutSec 30 -IntervalSec 2 -Test {
  $r = Get-JsonSafely -Uri $Mt5HealthUrl -TimeoutSec 3
  $r.Success -and $r.Body.status -eq 'ok'
}

if ($mt5Ready) {
  Write-Ok ('MT5 connector healthy at ' + $Mt5HealthUrl)
} else {
  Write-FailLine 'MT5 connector did not report healthy within 30s.'
  $Summary['MT5 connector'].Status = 'FAILED'
  $Summary['MT5 connector'].Detail = "No 200 'ok' from " + $Mt5HealthUrl + " - check the 'Telos - MT5 Connector' window for a Python traceback (missing MetaTrader5 package, or port 3100 already in use)."
}

# ---------------------------------------------------------------------
# Step 5 - MT5 account-info (visual confirmation of attached account)
# ---------------------------------------------------------------------
if ($mt5Ready) {
  Write-StepHeader 'Step 5/7: Confirming the MT5 terminal is logged in'
  $accountInfo = Get-JsonSafely -Uri $Mt5AccountInfoUrl -TimeoutSec 10

  if (-not ($accountInfo.Success -and $accountInfo.Body.ok)) {
    Write-WarnLine 'MT5 desktop terminal is not logged in.'
    Write-Host ''
    Write-Host '  MT5 desktop terminal is not logged in - log in now, then press Enter to continue.' -ForegroundColor Yellow
    Read-Host | Out-Null

    $accountInfo = Get-JsonSafely -Uri $Mt5AccountInfoUrl -TimeoutSec 10
  }

  if ($accountInfo.Success -and $accountInfo.Body.ok) {
    $login = $accountInfo.Body.login
    $acctType = $accountInfo.Body.account_type
    Write-Ok ('Attached MT5 account - login: ' + $login + ', account_type: ' + $acctType + ' (confirm this is the right account)')
    $Summary['MT5 connector'].Status = 'HEALTHY'
    $Summary['MT5 connector'].Detail = 'healthy, attached account login=' + $login + ' account_type=' + $acctType
  } else {
    $msg = if ($accountInfo.Body -and $accountInfo.Body.message) { $accountInfo.Body.message } else { $accountInfo.Message }
    Write-FailLine ('Still no attached MT5 account after retry: ' + $msg)
    $Summary['MT5 connector'].Status = 'FAILED'
    $Summary['MT5 connector'].Detail = 'Connector is up but /account-info still errors (' + $msg + ') - log into the MT5 desktop terminal and re-run this script.'
  }
}

# ---------------------------------------------------------------------
# Step 6 - Cloudflare tunnel
# ---------------------------------------------------------------------
Write-StepHeader 'Step 6/7: Starting the Cloudflare tunnel'

$tunnelAlreadyUp = Get-JsonSafely -Uri $TunnelHealthUrl -TimeoutSec 5
if ($tunnelAlreadyUp.Success -and $tunnelAlreadyUp.Body.status -eq 'ok') {
  Write-Ok ($TunnelHealthUrl + ' is already healthy - not spawning a duplicate tunnel window.')
} else {
  if (-not (Test-Path $TunnelLauncher)) {
    Write-FailLine ('Tunnel launcher not found at ' + $TunnelLauncher)
  } else {
    $tunnelCommand = "& '" + $TunnelLauncher + "'"
    Start-LabeledWindow -Title 'Telos - Cloudflare Tunnel' -Command $tunnelCommand
    Write-Host '  spawned window: Telos - Cloudflare Tunnel'
  }
}

$tunnelReady = Wait-Until -TimeoutSec 60 -IntervalSec 3 -Test {
  $r = Get-JsonSafely -Uri $TunnelHealthUrl -TimeoutSec 5
  $r.Success -and $r.Body.status -eq 'ok'
}

if ($tunnelReady) {
  Write-Ok ('Tunnel healthy - ' + $TunnelHealthUrl + ' responded ok.')
  $Summary['Cloudflare tunnel'].Status = 'HEALTHY'
  $Summary['Cloudflare tunnel'].Detail = $TunnelHealthUrl + ' -> ok'
} else {
  Write-FailLine ($TunnelHealthUrl + ' did not respond ok within 60s.')
  $Summary['Cloudflare tunnel'].Status = 'FAILED'
  $Summary['Cloudflare tunnel'].Detail = 'No healthy response from ' + $TunnelHealthUrl + " - check the 'Telos - Cloudflare Tunnel' window for errors, confirm cloudflared.exe and %USERPROFILE%\.cloudflared\config.yml are present, and that the backend (step 7) is actually up (this check depends on it)."
}

# ---------------------------------------------------------------------
# Step 7 - Backend (via the existing launcher only, never plain node)
# ---------------------------------------------------------------------
Write-StepHeader 'Step 7/7: Starting the backend'

# Confirm - by reading the launcher's own source, not by guessing - that
# this launcher unconditionally forces NODE_ENV=production before it
# ever calls node. This is what "Confirm NODE_ENV is production" checks
# against; /health intentionally returns only {status:'ok'} (no env
# leak over HTTP), so the confirmation has to come from the launcher's
# contract instead of a wire response.
$launcherForcesProdEnv = $false
if (Test-Path $BackendLauncher) {
  $launcherSource = Get-Content -Raw -Path $BackendLauncher
  $launcherForcesProdEnv = $launcherSource -match "NODE_ENV\s*=\s*'production'"
}

$backendAlreadyUp = Get-JsonSafely -Uri $BackendHealthUrl -TimeoutSec 3
if ($backendAlreadyUp.Success -and $backendAlreadyUp.Body.status -eq 'ok') {
  Write-Ok 'Backend is already running and healthy - not spawning a duplicate window.'
} else {
  if (-not (Test-Path $BackendLauncher)) {
    Write-FailLine ('Backend launcher not found at ' + $BackendLauncher)
  } else {
    $backendCommand = "& '" + $BackendLauncher + "'"
    Start-LabeledWindow -Title 'Telos - Backend' -Command $backendCommand
    Write-Host '  spawned window: Telos - Backend'
  }
}

$backendReady = Wait-Until -TimeoutSec 60 -IntervalSec 2 -Test {
  $r = Get-JsonSafely -Uri $BackendHealthUrl -TimeoutSec 3
  $r.Success -and $r.Body.status -eq 'ok'
}

if ($backendReady) {
  Write-Ok ('Backend healthy at ' + $BackendHealthUrl)
  if ($launcherForcesProdEnv) {
    Write-Ok ('NODE_ENV confirmed production (' + $BackendLauncher + ' unconditionally sets NODE_ENV to production before launching node).')
    $Summary['Backend'].Status = 'HEALTHY'
    $Summary['Backend'].Detail = $BackendHealthUrl + ' -> ok, NODE_ENV=production (forced by start-telos-backend.ps1)'
  } else {
    Write-WarnLine ('Backend is healthy, but could not confirm NODE_ENV=production from ' + $BackendLauncher + "'s source - inspect that script.")
    $Summary['Backend'].Status = 'HEALTHY (env unconfirmed)'
    $Summary['Backend'].Detail = $BackendHealthUrl + ' -> ok, but NODE_ENV=production could not be confirmed from the launcher source'
  }
} else {
  Write-FailLine 'Backend did not report healthy within 60s.'
  $Summary['Backend'].Status = 'FAILED'
  $Summary['Backend'].Detail = "No 200 'ok' from " + $BackendHealthUrl + " - check the 'Telos - Backend' window for a Node stack trace (commonly: DATABASE_URL/REDIS_URL unreachable, or port 3000 already bound)."
}

# ---------------------------------------------------------------------
# Final re-verification pass (not one of the numbered steps)
#
# Observed during testing: on this machine, backend boot (DB connect +
# bot-runtime rehydration) and the Cloudflare tunnel (which depends on
# the backend already answering :3000) can both legitimately take
# longer than their per-step budget above under load. Per-step timeouts
# above are left exactly as specified so a genuinely stuck service is
# still caught and reported within that budget - but before writing the
# final summary, give anything that FAILED one more bounded look so a
# merely-slow boot isn't misreported as broken.
# ---------------------------------------------------------------------
$GraceSec = 20

if ($Summary['MT5 connector'].Status -eq 'FAILED') {
  $recheck = Wait-Until -TimeoutSec $GraceSec -IntervalSec 3 -Test {
    $r = Get-JsonSafely -Uri $Mt5HealthUrl -TimeoutSec 3
    $r.Success -and $r.Body.status -eq 'ok'
  }
  if ($recheck) {
    $Summary['MT5 connector'].Status = 'HEALTHY (slow to start)'
    $Summary['MT5 connector'].Detail = $Mt5HealthUrl + ' -> ok on final re-check (took longer than the 30s step budget)'
  }
}

if ($Summary['Backend'].Status -eq 'FAILED') {
  $recheck = Wait-Until -TimeoutSec $GraceSec -IntervalSec 3 -Test {
    $r = Get-JsonSafely -Uri $BackendHealthUrl -TimeoutSec 3
    $r.Success -and $r.Body.status -eq 'ok'
  }
  if ($recheck) {
    if ($launcherForcesProdEnv) {
      $Summary['Backend'].Status = 'HEALTHY (slow to start)'
      $Summary['Backend'].Detail = $BackendHealthUrl + ' -> ok on final re-check (took longer than the 60s step budget), NODE_ENV=production (forced by start-telos-backend.ps1)'
    } else {
      $Summary['Backend'].Status = 'HEALTHY (slow to start, env unconfirmed)'
      $Summary['Backend'].Detail = $BackendHealthUrl + ' -> ok on final re-check, but NODE_ENV=production could not be confirmed from the launcher source'
    }
  }
}

if ($Summary['Cloudflare tunnel'].Status -eq 'FAILED') {
  $recheck = Wait-Until -TimeoutSec $GraceSec -IntervalSec 3 -Test {
    $r = Get-JsonSafely -Uri $TunnelHealthUrl -TimeoutSec 5
    $r.Success -and $r.Body.status -eq 'ok'
  }
  if ($recheck) {
    $Summary['Cloudflare tunnel'].Status = 'HEALTHY (slow to start)'
    $Summary['Cloudflare tunnel'].Detail = $TunnelHealthUrl + ' -> ok on final re-check (likely was waiting on the backend to finish starting)'
  }
}

# ---------------------------------------------------------------------
# Step 8 - Final summary
# ---------------------------------------------------------------------
Write-StepHeader 'Final summary'
$anyFailed = $false
foreach ($name in $Summary.Keys) {
  $row = $Summary[$name]
  if ($row.Status -like 'FAILED*') { $anyFailed = $true }
  $tag = switch -Wildcard ($row.Status) {
    'HEALTHY*'       { '[ OK ]' }
    'FAILED*'        { '[FAIL]' }
    'not attempted'  { '[SKIP]' }
    default          { '[ ?? ]' }
  }
  Write-Host ("  {0} {1,-32} {2}" -f $tag, $name, $row.Status)
  if ($row.Detail) {
    Write-Host ("         -> {0}" -f $row.Detail)
  }
}
Write-Host ''

if ($anyFailed) {
  Write-Host 'One or more services failed to come up healthy - see remediation notes above.' -ForegroundColor Red
  exit 1
} else {
  Write-Host 'All services healthy.' -ForegroundColor Green
  exit 0
}
