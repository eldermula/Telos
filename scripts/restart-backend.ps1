# Pull latest mainline changes and restart the local Telos backend
# (backend/package.json -> npm start -> node src/index.js).
# Usage (from anywhere):  powershell -File scripts/restart-backend.ps1

$ErrorActionPreference = 'Stop'

$RepoRoot = Join-Path $PSScriptRoot '..' | Resolve-Path
$BackendDir = Join-Path $RepoRoot 'backend'
$BackendPort = 3000

Write-Host 'pulling...'
Set-Location $RepoRoot
git pull
if ($LASTEXITCODE -ne 0) {
  throw "git pull failed with exit code $LASTEXITCODE"
}

Write-Host 'stopping...'
$stopped = $false
$listeners = Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $listeners) {
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($null -eq $proc) { continue }
  Write-Host "  stopping PID $procId ($($proc.ProcessName))"
  Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  $stopped = $true
}
if (-not $stopped) {
  Write-Host '  no listener on port 3000 - nothing to stop'
}
Start-Sleep -Seconds 1

Write-Host 'starting...'
Set-Location $BackendDir
Start-Process -FilePath 'npm' -ArgumentList 'start' -WorkingDirectory $BackendDir -WindowStyle Hidden
Start-Sleep -Seconds 2

$up = $false
for ($i = 1; $i -le 15; $i++) {
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$BackendPort/health" -UseBasicParsing -TimeoutSec 2
    Write-Host "  health: $($resp.Content)"
    $up = $true
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}
if (-not $up) {
  Write-Host '  warning: health check did not succeed yet - backend may still be starting'
}

Write-Host 'done'
