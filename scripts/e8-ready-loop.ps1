# Wait until Mon 2026-08-10 08:00 SAST (06:00 UTC), then probe every 30m.
# Emits AGENT_LOOP_TICK_e8_ready when FX looks open. Does NOT run the smoke.
$ErrorActionPreference = 'Continue'
$Probe = Join-Path $PSScriptRoot 'e8-market-probe.js'
$target = [datetime]::Parse('2026-08-10T06:00:00Z').ToUniversalTime()
$now = [datetime]::UtcNow
$initialSleep = [int][Math]::Max(60, ($target - $now).TotalSeconds)
Write-Output "E8_LOOP_ARMED initial_sleep_sec=$initialSleep until=$($target.ToString('o')) interval_sec=1800"
Start-Sleep -Seconds $initialSleep

while ($true) {
  $raw = & node $Probe 2>$null
  $ts = (Get-Date).ToUniversalTime().ToString('o')
  Write-Output "E8_PROBE $ts $raw"
  try {
    $j = $raw | ConvertFrom-Json
    if ($j.ok -and -not $j.closed) {
      Write-Output 'AGENT_LOOP_TICK_e8_ready {"prompt":"E.8 FX market looks open (fresh tick). Flag the user to watch; do NOT auto-run smoke-option2-e8-live-demo-roundtrip.js — wait for them to say go, then run it with them watching."}'
    }
  } catch {}
  Start-Sleep -Seconds 1800
}
