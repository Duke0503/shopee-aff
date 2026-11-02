# The cutover phases and the rollback (Stories 8.7 and 8.8). Each Invoke-Phase-<name> returns a
# small detail table (counts, names, codes) for its log line, or throws a reason code. Rehearsal
# mode never touches a task, a service, the machine PATH or the live folder (cutover-common.ps1
# refuses it), and its server reaches no network.

function Get-PhaseFailure($Answer, [string]$Code) {
  $reason = $Code
  if ($null -ne $Answer.line -and $Answer.line.ContainsKey("reason")) { $reason = "${Code}:$($Answer.line.reason)" }
  return $reason
}

function Save-StepLine($Ctx, [string]$File, $Line) {
  $Line | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Ctx.WorkDir $File) -Encoding UTF8
}

function Get-SourceDb($Ctx) {
  if ($Ctx.Mode -eq "Live") { return $Ctx.LiveDb }
  return $Ctx.LiveCopy
}

function Get-FinalDb($Ctx) { return Join-Path $Ctx.FinalDir "live-final.db" }

# The one list of required builds lives in the server (REQUIRED_BUILDS in cutover-preflight.ts).
function Assert-BuildsPresent($Ctx) {
  $answer = Invoke-CutoverStep $Ctx @("builds")
  if ($answer.code -ne 0) { throw "build_missing:$(@($answer.line.missing) -join '+')" }
}

function Get-FreeMemoryMb {
  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
  if ($null -eq $os) { return $null }
  return [math]::Round($os.FreePhysicalMemory / 1024)
}

function Invoke-Phase-preflight($Ctx) {
  $version = (& $Ctx.Node --version).Trim()
  if (-not $version.StartsWith("v24.")) { throw "node_not_24:$version" }
  Assert-BuildsPresent $Ctx
  $source = Get-SourceDb $Ctx
  if (-not (Test-Path -LiteralPath $source)) { throw "live_db_missing" }
  $sourceBytes = (Get-Item -LiteralPath $source).Length
  $drive = (Get-Item -LiteralPath $Ctx.WorkDir).PSDrive
  $freeBytes = (Get-PSDrive -Name $drive.Name).Free
  if ($freeBytes -lt (3 * $sourceBytes + 1GB)) { throw "disk_low" }
  $detail = [ordered]@{ node = $version; liveDbMb = [math]::Round($sourceBytes / 1MB, 1); freeDiskGb = [math]::Round($freeBytes / 1GB, 1); freeMemoryMb = (Get-FreeMemoryMb) }
  if ($Ctx.Mode -eq "Rehearsal") {
    $answer = Invoke-CutoverStep $Ctx @("rehearsal-env", "--home", $Ctx.RehearsalHome, "--work", $Ctx.WorkDir, "--port", [string]$Ctx.RehearsalPort, "--live-ledger", (Join-Path $script:LiveFolder "cashback.db"))
    if ($answer.code -ne 0) { throw (Get-PhaseFailure $answer "rehearsal_env_failed") }
    $detail.rehearsalEnvCreated = $answer.line.created
    return $detail
  }
  Assert-Elevated
  Assert-NotLiveFolder $Ctx.Root
  Assert-EnvFileOutsideRepository "prod" $Ctx.Root
  foreach ($file in @($Ctx.LiveEnv, $Ctx.LiveCredentials)) { if (-not (Test-Path -LiteralPath $file)) { throw "missing:$([System.IO.Path]::GetFileName($file))" } }
  $tasks = @{}
  foreach ($name in $script:CutoverLiveTasks) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($null -eq $task) { throw "live_task_missing:$name" }
    $tasks[$name] = [string]$task.State
  }
  $tunnel = Get-Service -Name cloudflared -ErrorAction SilentlyContinue
  if ($null -eq $tunnel -or $tunnel.Status -ne "Running") { throw "cloudflared_not_running" }
  $runner = @(Get-Service -Name "actions.runner.*" -ErrorAction SilentlyContinue)
  if ($runner.Count -gt 1) { throw "runner_ambiguous" }
  if (-not $Ctx.State.ContainsKey("machinePath")) {
    $Ctx.State.liveTasks = $tasks
    $Ctx.State.machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $current = Get-Command node.exe -ErrorAction SilentlyContinue
    $Ctx.State.node20Dir = $null
    if ($null -ne $current) { $Ctx.State.node20Dir = Split-Path -Parent $current.Source }
    $Ctx.State.runner = $null
    if ($runner.Count -eq 1) { $Ctx.State.runner = @{ name = $runner[0].Name; startType = [string]$runner[0].StartType; status = [string]$runner[0].Status } }
    Save-CutoverState $Ctx
  }
  $arguments = @("preflight", "--live-env", $Ctx.LiveEnv)
  if ($Ctx.AcceptGaps -ne "") { $arguments += @("--accept-gaps", $Ctx.AcceptGaps) }
  $answer = Invoke-CutoverStep $Ctx $arguments
  if ($answer.code -ne 0) { throw "preflight_refused:$(@($answer.line.problems) -join '+')" }
  $Ctx.State.openGaps = @($answer.line.openGaps)
  Save-CutoverState $Ctx
  $detail.openGaps = @($answer.line.openGaps)
  $detail.runner = ($null -ne $Ctx.State.runner)
  return $detail
}

function Invoke-Phase-stop-old($Ctx) {
  if ($Ctx.Mode -eq "Rehearsal") {
    return [ordered]@{ dryRun = $true; wouldStopTasks = $script:CutoverLiveTasks; wouldDisableRunner = "actions.runner.*"; wouldWaitPortsFree = $script:CutoverLivePorts }
  }
  if (-not $Ctx.ConfirmOldExtensionRemoved) { throw "old_extension_not_confirmed" }
  if ($null -ne $Ctx.State.runner) {
    Stop-Service -Name $Ctx.State.runner.name -ErrorAction SilentlyContinue
    Set-Service -Name $Ctx.State.runner.name -StartupType Disabled
  }
  foreach ($name in $script:CutoverLiveTasks) { Stop-CutoverLiveTask $Ctx $name }
  $free = Wait-Until { (Get-ListeningPorts $script:CutoverLivePorts).Count -eq 0 } 60
  $stopped = @()
  if (-not $free) {
    # Children the live tasks started (scripts/start-all.ps1 windows) can outlive the task: stop
    # the process that owns each live port, by port, never by name.
    foreach ($listener in (Get-ListeningPorts $script:CutoverLivePorts)) {
      $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
      if ($null -ne $owner) {
        $stopped += [ordered]@{ port = $listener.LocalPort; pid = $owner.Id; process = $owner.ProcessName }
        Stop-Process -Id $owner.Id -Force
      }
    }
    $free = Wait-Until { (Get-ListeningPorts $script:CutoverLivePorts).Count -eq 0 } 20
  }
  if (-not $free) { throw "live_ports_still_listening" }
  return [ordered]@{ stoppedTasks = $script:CutoverLiveTasks; runnerDisabled = ($null -ne $Ctx.State.runner); stoppedByPort = $stopped }
}

function Invoke-Phase-final-backup($Ctx) {
  $arguments = @("backup", (Get-SourceDb $Ctx), $Ctx.FinalDir)
  if ($Ctx.Mode -eq "Live") { $arguments += @("--encrypt-env", "prod") }
  $answer = Invoke-CutoverStep $Ctx $arguments
  if ($answer.code -ne 0) { throw (Get-PhaseFailure $answer "backup_failed") }
  return [ordered]@{ sha256 = $answer.line.sha256; bytes = $answer.line.bytes; staged = $answer.line.staged; encrypted = ($null -ne $answer.line.encrypted); reused = $answer.line.reused }
}

function Invoke-Phase-import($Ctx) {
  $report = "$($Ctx.NewLedger).import-report.json"
  if ((Test-Path -LiteralPath $Ctx.NewLedger) -and (Test-Path -LiteralPath $report)) {
    $outcome = (Get-Content -LiteralPath $report -Raw | ConvertFrom-Json).outcome
    if ($outcome.ok) { return [ordered]@{ reused = $true } }
  }
  foreach ($file in @($Ctx.NewLedger, "$($Ctx.NewLedger)-wal", "$($Ctx.NewLedger)-shm", $report)) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
  $answer = Invoke-CutoverNode $Ctx (Join-Path $Ctx.Root "apps\server\src\cutover\run-import.ts") @((Get-FinalDb $Ctx), $Ctx.NewLedger) "step-import"
  if ($answer.code -ne 0) { throw (Get-PhaseFailure $answer "import_failed") }
  return [ordered]@{ timeProblems = $answer.line.timeProblems; notes = $answer.line.notes; reused = $false }
}

function Invoke-Phase-parity($Ctx) {
  $answer = Invoke-CutoverStep $Ctx @("gate", (Get-FinalDb $Ctx), $Ctx.NewLedger)
  if ($null -ne $answer.line) { Save-StepLine $Ctx "parity.json" $answer.line }
  if ($answer.code -ne 0) {
    if ($null -ne $answer.line -and $answer.line.ContainsKey("problems")) { throw "parity_failed:$(@($answer.line.problems) -join '+')" }
    throw (Get-PhaseFailure $answer "parity_failed")
  }
  return [ordered]@{ result = $answer.line.result; counts = $answer.line.counts; paidCustomers = $answer.line.paid.customers; paidTotal = $answer.line.paid.importedTotal }
}

# Every order, transfer, customer total and network batch, live against new; any difference
# without a documented reason fails the cutover (audit.json, audit.md in the work folder).
function Invoke-Phase-audit($Ctx) {
  $answer = Invoke-CutoverStep $Ctx @("audit", (Get-FinalDb $Ctx), $Ctx.NewLedger, "--out", $Ctx.WorkDir)
  if ($answer.code -ne 0) {
    if ($null -ne $answer.line -and $answer.line.ContainsKey("unexplained")) { throw "audit_failed:unexplained=$($answer.line.unexplained)" }
    throw (Get-PhaseFailure $answer "audit_failed")
  }
  return [ordered]@{ result = $answer.line.result; orders = $answer.line.orders; payouts = $answer.line.payouts; customers = $answer.line.customers; batches = $answer.line.batches; explained = $answer.line.explained; totals = $answer.line.totals }
}

function Invoke-Phase-first-run($Ctx) {
  $arguments = @($Ctx.NewLedger)
  if ($Ctx.ShopeeReport -ne "") { $arguments += @("--shopee", $Ctx.ShopeeReport) }
  if ($Ctx.ShopeeMapping -ne "") { $arguments += @("--shopee-mapping", $Ctx.ShopeeMapping) }
  if ($Ctx.AccesstradeReport -ne "") { $arguments += @("--accesstrade", $Ctx.AccesstradeReport) }
  $answer = Invoke-CutoverNode $Ctx (Join-Path $Ctx.Root "apps\server\src\cutover\run-first-run.ts") $arguments "step-first-run"
  if ($null -ne $answer.line) { Save-StepLine $Ctx "first-run.json" $answer.line }
  if ($answer.code -ne 0) { throw (Get-PhaseFailure $answer "first_run_failed") }
  $flags = Invoke-CutoverStep $Ctx @("flags", $Ctx.NewLedger)
  if ($flags.code -ne 0) { throw "flags_not_set" }
  return [ordered]@{ messagingSilent = $flags.line.messagingSilent; payoutWindowEndsAt = $flags.line.payoutWindowEndsAt; firstRun = $answer.line }
}
