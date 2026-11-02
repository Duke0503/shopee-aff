# The cutover phases that bring the new system up (carry-over, start-new, smoke), the rollback and
# the go/no-go checklist (Stories 8.7 and 8.8).

function New-PlaceholderValue { return -join ((1..40) | ForEach-Object { "abcdefghijkmnpqrstuvwxyz23456789"[(Get-Random -Maximum 32)] }) }

# Rehearsal: the carry-over runs on two throw-away files with placeholder values, and the phase
# proves that none of them reached its own output or log.
function Invoke-RehearsalCarryOver($Ctx) {
  $dir = Join-Path $Ctx.WorkDir "carry-test"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $values = @{ TELEGRAM_BOT_TOKEN = "1234567:$(New-PlaceholderValue)"; ACCESSTRADE_API_KEY = (New-PlaceholderValue) }
  $live = Join-Path $dir "live.env"
  $prod = Join-Path $dir "prod.env"
  Set-Content -LiteralPath $live -Encoding ASCII -Value @("TELEGRAM_BOT_TOKEN=$($values.TELEGRAM_BOT_TOKEN)", "ACCESSTRADE_API_KEY=$($values.ACCESSTRADE_API_KEY)", "TELEGRAM_CHAT_ID=-1000000000001", "ZALO_MAIN_GROUP_ID=1000000000000000001", "ZALO_TEST_GROUP_ID=1000000000000000002")
  Set-Content -LiteralPath $prod -Encoding ASCII -Value @("INTERNAL_TOKEN=$(New-PlaceholderValue)")
  $answer = Invoke-CutoverStep $Ctx @("carry-over", "--live-env", $live, "--prod-env", $prod, "--set", "PUBLIC_PORT=80")
  if ($answer.code -ne 0) { throw (Get-PhaseFailure $answer "carry_over_failed") }
  $printed = (Get-Content -LiteralPath (Join-Path $Ctx.WorkDir "step-carry-over.out.log") -Raw) + (Get-Content -LiteralPath $Ctx.LogFile -Raw)
  foreach ($value in $values.Values) { if ($printed.Contains($value)) { throw "secret_printed" } }
  $written = Get-Content -LiteralPath $prod -Raw
  foreach ($value in $values.Values) { if (-not $written.Contains($value)) { throw "carry_over_incomplete" } }
  return [ordered]@{ dryRun = $true; carried = @($answer.line.carried); fixed = @($answer.line.fixed); secretPrinted = $false }
}

function Invoke-Phase-carry-over($Ctx) {
  if ($Ctx.Mode -eq "Rehearsal") { return Invoke-RehearsalCarryOver $Ctx }
  if (@(Get-ListeningPorts @(8891)).Count -gt 0) { throw "live_assistant_still_running" }
  $zaloDir = Join-Path $env:USERPROFILE ".config\cashback\zalo"
  $credentials = Join-Path $zaloDir "credentials.json"
  $sets = @("--set", "PUBLIC_PORT=$($Ctx.PublicPort)", "--set", "LIVE_LEDGER_PATH=$($Ctx.LiveDb)", "--set", "ZALO_CREDENTIALS_PATH=$credentials")
  $answer = Invoke-CutoverStep $Ctx (@("carry-over", "--live-env", $Ctx.LiveEnv, "--prod-env", (Get-EnvFilePath "prod")) + $sets)
  if ($answer.code -ne 0) { throw (Get-PhaseFailure $answer "carry_over_failed") }
  # The Zalo session moves only now, with the live assistant stopped: one account, one session.
  New-Item -ItemType Directory -Force -Path $zaloDir | Out-Null
  Copy-Item -LiteralPath $Ctx.LiveCredentials -Destination $credentials -Force
  & icacls $credentials /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null
  & icacls (Get-EnvFilePath "prod") /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null
  return [ordered]@{ carried = @($answer.line.carried); already = @($answer.line.already); kept = @($answer.line.kept); missing = @($answer.line.missing); fixed = @($answer.line.fixed); zaloSession = "copied" }
}

# Live: Node 24 replaces Node 20 on the machine PATH; Node 20 stays on disk, off PATH, for the rollback.
function Switch-MachineNode($Ctx) {
  $original = $Ctx.State.machinePath
  $old = $Ctx.State.node20Dir
  $kept = @($original -split ";" | Where-Object { $_ -ne "" -and ($null -eq $old -or $_.TrimEnd("\") -ine $old.TrimEnd("\")) -and $_.TrimEnd("\") -ine $Ctx.Node24Dir.TrimEnd("\") })
  $new = (@($Ctx.Node24Dir) + $kept) -join ";"
  [Environment]::SetEnvironmentVariable("Path", $new, "Machine")
  $process = @($env:Path -split ";" | Where-Object { $_ -ne "" -and ($null -eq $old -or $_.TrimEnd("\") -ine $old.TrimEnd("\")) })
  $env:Path = (@($Ctx.Node24Dir) + $process) -join ";"
}

# Go-live starts the 72-hour no-payout window on the installed ledger before its server starts,
# so the payout window and the rollback window are one clock.
function Start-GoLive($Ctx, [string]$Ledger) {
  $live = Invoke-CutoverStep $Ctx @("go-live", $Ledger)
  if ($live.code -ne 0) { throw (Get-PhaseFailure $live "go_live_failed") }
  $Ctx.State.goLiveAt = $live.line.goLiveAt
  $Ctx.State.payoutWindowEndsAt = $live.line.payoutWindowEndsAt
  Save-CutoverState $Ctx
}

function Invoke-Phase-start-new($Ctx) {
  if ($Ctx.Mode -eq "Rehearsal") {
    $answer = Invoke-CutoverStep $Ctx @("install-ledger", $Ctx.NewLedger, "--env", "dev")
    if ($answer.code -ne 0) { throw (Get-PhaseFailure $answer "install_ledger_failed") }
    Start-GoLive $Ctx $answer.line.target
    $started = Invoke-CutoverNode $Ctx (Join-Path $Ctx.Root "apps\server\src\host\run-host.ts") @("start", "server", "--env", "dev") "step-host-start"
    if ($started.code -ne 0) { throw "server_not_started" }
    $Ctx.State.rehearsalServer = $true
    Save-CutoverState $Ctx
    if (-not (Wait-Until { Test-HttpOk "http://127.0.0.1:$($Ctx.RehearsalPort)/api/health" } 120)) { throw "health_not_ok" }
    return [ordered]@{ port = $Ctx.RehearsalPort; ledgerInstalled = $true; goLiveAt = (Get-StateValue $Ctx "goLiveAt"); payoutWindowEndsAt = (Get-StateValue $Ctx "payoutWindowEndsAt"); quiet = $true }
  }
  Switch-MachineNode $Ctx
  # A shadow-run server of the new platform holds the ledger: stop it before the ledger changes.
  if (Get-ScheduledTask -TaskName $OwnTasks.server -ErrorAction SilentlyContinue) { & (Join-Path $PSScriptRoot "..\stop.ps1") | Out-Host }
  $answer = Invoke-CutoverStep $Ctx @("install-ledger", $Ctx.NewLedger, "--env", "prod")
  if ($answer.code -ne 0) { throw (Get-PhaseFailure $answer "install_ledger_failed") }
  Start-GoLive $Ctx $answer.line.target
  $installArgs = @{}
  if (@((Get-StateValue $Ctx "openGaps")).Count -gt 0) { $installArgs.AllowGaps = $true }
  & (Join-Path $PSScriptRoot "..\install-tasks.ps1") @installArgs | Out-Host
  & (Join-Path $PSScriptRoot "..\start.ps1") | Out-Host
  if (-not (Wait-Until { Test-HttpOk "http://127.0.0.1:$($Ctx.PublicPort)/api/health" } 600)) { throw "health_not_ok" }
  return [ordered]@{ port = $Ctx.PublicPort; movedAside = $answer.line.movedAside; goLiveAt = (Get-StateValue $Ctx "goLiveAt"); payoutWindowEndsAt = (Get-StateValue $Ctx "payoutWindowEndsAt"); quiet = $true }
}

# The full sample on 127.0.0.1, then one share link and receipt by localhost and [::1] (the tunnel's
# route names localhost) and, live, through the tunnel.
function Invoke-Phase-smoke($Ctx) {
  $arguments = @("smoke", $Ctx.NewLedger, "--sample", [string]$Ctx.SampleSize, "--localhost")
  if ($Ctx.Mode -eq "Rehearsal") { $arguments += @("--local", "http://127.0.0.1:$($Ctx.RehearsalPort)") }
  else { $arguments += @("--local", "http://127.0.0.1:$($Ctx.PublicPort)", "--host", $Ctx.PublicHost, "--public", "https://$($Ctx.PublicHost)") }
  $answer = Invoke-CutoverStep $Ctx $arguments
  if ($null -ne $answer.line) { Save-StepLine $Ctx "smoke.json" $answer.line }
  if ($answer.code -ne 0) { throw "smoke_failed:$(@($answer.line.failed).Count):$(@($answer.line.problems) -join '+')" }
  return [ordered]@{ checks = $answer.line.checks; shareCodes = $answer.line.sampled.shareCodes; receipts = $answer.line.sampled.receipts; available = $answer.line.available }
}

# A rehearsal always ends with its server stopped; when it did not finish, start-new runs again on
# the next resume so smoke finds a server.
function Stop-RehearsalServer($Ctx, [bool]$Complete = $false) {
  if ($Ctx.Mode -ne "Rehearsal" -or -not $Ctx.State.ContainsKey("rehearsalServer")) { return }
  [void](Invoke-CutoverNode $Ctx (Join-Path $Ctx.Root "apps\server\src\host\run-host.ts") @("stop", "server", "--env", "dev") "step-host-stop")
  $Ctx.State.Remove("rehearsalServer")
  if (-not $Complete) { $Ctx.State.phases.Remove("start-new") }
  Save-CutoverState $Ctx
}

# A closed payout window means payouts may exist in the new ledger: the old system would pay again.
function Assert-PayoutWindowOpen($Ctx) {
  if ($null -eq (Get-StateValue $Ctx "goLiveAt")) { return }
  $ledger = Get-ConfiguredLedger $Ctx "prod"
  if (-not (Test-Path -LiteralPath $ledger)) { return }
  $flags = Invoke-CutoverStep $Ctx @("flags", $ledger)
  if ($null -eq $flags.line -or $flags.line.payoutWindowOpen -ne $true) { throw "Refused: the payout window was closed, payouts may exist in the new ledger; rollback is no longer safe." }
}

# Stop the new system, give port 80 back to the live system, restore the old Node PATH, restart the
# live tasks and the runner. Offered only inside the 72-hour window.
function Invoke-CutoverRollback($Ctx, [string]$Reason) {
  if ($Ctx.Mode -eq "Rehearsal") {
    Stop-RehearsalServer $Ctx
    Write-CutoverLog $Ctx ([ordered]@{ event = "cutover.rollback"; reason = $Reason; dryRun = $true; wouldStartTasks = $script:CutoverLiveTasks; wouldRestoreRunner = $true; wouldRestoreMachinePath = $true })
    return
  }
  if (-not (Test-InsideWindow $Ctx)) { throw "Refused: rollback is offered only inside the 72-hour window; the new system is final." }
  Assert-PayoutWindowOpen $Ctx
  $steps = [ordered]@{}
  try { & (Join-Path $PSScriptRoot "..\stop.ps1") | Out-Host; $steps.newStopped = $true } catch { $steps.newStopped = $false }
  $steps.port80Free = Wait-Until { @(Get-ListeningPorts @($Ctx.PublicPort)).Count -eq 0 } 60
  if ($Ctx.State.ContainsKey("machinePath") -and $null -ne $Ctx.State.machinePath) {
    [Environment]::SetEnvironmentVariable("Path", $Ctx.State.machinePath, "Machine")
    $steps.machinePathRestored = $true
  }
  foreach ($name in $script:CutoverLiveTasks) {
    $before = $null
    if ($null -ne $Ctx.State.liveTasks) { $before = $Ctx.State.liveTasks[$name] }
    if ($before -ne "Disabled") { Start-CutoverLiveTask $Ctx $name }
  }
  $steps.livePort80 = Wait-Until { @(Get-ListeningPorts @(80)).Count -gt 0 } 180
  if ($null -ne (Get-StateValue $Ctx "runner")) {
    Set-Service -Name (Get-StateValue $Ctx "runner").name -StartupType (Get-StateValue $Ctx "runner").startType
    if ((Get-StateValue $Ctx "runner").status -eq "Running") { Start-Service -Name (Get-StateValue $Ctx "runner").name }
    $steps.runnerRestored = $true
  }
  $Ctx.State.rolledBackAt = Get-UtcStamp
  Save-CutoverState $Ctx
  Write-CutoverLog $Ctx ([ordered]@{ event = "cutover.rollback"; reason = $Reason; at = (Get-StateValue $Ctx "rolledBackAt"); steps = $steps; manual = "re-enable the old extension in the old Edge profile (go-live-runbook.md section 7)" })
}

function Write-GoNoGo($Ctx, [bool]$Succeeded, [int]$PlannedDowntimeMinutes) {
  $rows = @()
  $downtime = 0.0
  foreach ($phase in $script:CutoverPhases) {
    $p = $Ctx.State.phases[$phase]
    $status = "not run"; $seconds = ""
    if ($null -ne $p) { $status = $p.status; $seconds = $p.seconds }
    if ($null -ne $p -and $phase -ne "preflight" -and $null -ne $p.seconds) { $downtime += [double]$p.seconds }
    $rows += "| $phase | $status | $seconds |"
  }
  $minutes = [math]::Round($downtime / 60, 1)
  $verdict = "NO-GO"
  if ($Succeeded -and $minutes -le $PlannedDowntimeMinutes) { $verdict = "GO" }
  $lines = @(
    "# Cutover $($Ctx.Mode.ToLower()) go/no-go", "",
    "Generated $(Get-UtcStamp) from $($Ctx.StateFile). Verdict: **$verdict**.", "",
    "| Phase | Status | Seconds |", "| --- | --- | --- |") + $rows + @(
    "", "Downtime (stop-old to smoke): $minutes minutes; planned: $PlannedDowntimeMinutes minutes.", "",
    "Parity: parity.json. Numbers audit: audit.md. Would-be sends of the quiet first run: first-run.json. Smoke checks: smoke.json.",
    "Any phase not ok, or a downtime over the plan, is NO-GO until fixed and rehearsed again.", "",
    "- [ ] Shadow diff signed off (shadow-run.md)",
    "- [ ] Parity pass read in parity.json (counts equal, paid totals to the dong)",
    "- [ ] Numbers audit read in audit.md (every difference has a reason; 0 unexplained)",
    "- [ ] Would-be sends read in first-run.json", "",
    "Signed (owner): ____________________  Date: __________")
  Set-Content -LiteralPath (Join-Path $Ctx.WorkDir "go-no-go.md") -Encoding ASCII -Value $lines
  return $verdict
}
