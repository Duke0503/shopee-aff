# Shared by the cutover scripts (Stories 8.7 and 8.8, AD-24, D40, D61). Read
# docs/operations/go-live-runbook.md first.
#
# The cutover runs in one of two modes:
#   Rehearsal  on the operator's machine against a copy of the live database. It never touches a
#              Windows task, service, the machine PATH or the live folder, and reaches no network,
#              Zalo or Telegram: its server runs under a home folder of its own with fake bridge
#              and Zalo, on ports 9180/9181.
#   Live       on the production VPS, tonight. It stops the live system, imports, checks parity,
#              starts the new system on the port the tunnel already routes to, and rolls back on
#              any failure.
#
# Every phase writes one JSON line (to the console and to <WorkDir>\cutover-log.jsonl) and records
# its outcome in <WorkDir>\cutover-state.json, so a second run skips the phases already done and
# resumes at the first one that is not. No phase reads or prints a secret: values move between
# files inside `pnpm cutover:step`, which prints key names only.

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "..\common.ps1")

# The order of the phases. Nothing runs out of this order; a resumed run starts at the first
# phase not yet "ok".
$script:CutoverPhases = @("preflight", "stop-old", "final-backup", "import", "parity", "audit", "first-run", "carry-over", "start-new", "smoke")

# The live system's tasks and ports. Only the cutover's own guard functions below name them, and
# only in Live mode may they act on them.
$script:CutoverLiveTasks = @("CashbackBackend", "CashbackAssistant")
$script:CutoverLivePorts = @(80, 8899, 8891, 8787)
$script:CutoverWindowHours = 72

function New-CutoverContext([string]$Mode, [string]$WorkDir) {
  if ($Mode -ne "Rehearsal" -and $Mode -ne "Live") { throw "Mode must be Rehearsal or Live." }
  $root = Get-RepositoryRoot
  New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
  $work = (Resolve-Path $WorkDir).Path
  $ctx = @{
    Mode       = $Mode
    Root       = $root
    WorkDir    = $work
    LogFile    = Join-Path $work "cutover-log.jsonl"
    StateFile  = Join-Path $work "cutover-state.json"
    NewLedger  = Join-Path $work "new-ledger.sqlite"
    FinalDir   = Join-Path $work "final"
    Node       = $null
    StepEnv    = @{}
  }
  $ctx.State = Read-CutoverState $ctx
  return $ctx
}

function Get-UtcStamp { return (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ") }

# One JSON line, to the console and the log file. Values are counts, names, paths and codes.
function Write-CutoverLog($Ctx, $Entry) {
  $line = [ordered]@{ at = (Get-UtcStamp); mode = $Ctx.Mode }
  foreach ($key in $Entry.Keys) { $line[$key] = $Entry[$key] }
  $json = $line | ConvertTo-Json -Compress -Depth 8
  Add-Content -LiteralPath $Ctx.LogFile -Value $json -Encoding UTF8
  [Console]::Out.WriteLine($json)
}

function ConvertTo-PlainHashtable($Value) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [System.Management.Automation.PSCustomObject]) {
    $table = @{}
    foreach ($p in $Value.PSObject.Properties) { $table[$p.Name] = ConvertTo-PlainHashtable $p.Value }
    return $table
  }
  if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) { return @($Value | ForEach-Object { ConvertTo-PlainHashtable $_ }) }
  return $Value
}

function Get-StateValue($Ctx, [string]$Key) {
  # Strict mode: a key the state never had reads as null, never as an error.
  if ($null -eq $Ctx.State) { return $null }
  if ($Ctx.State -is [System.Collections.IDictionary]) { if ($Ctx.State.Contains($Key)) { return $Ctx.State[$Key] } else { return $null } }
  $prop = $Ctx.State.PSObject.Properties[$Key]
  if ($null -eq $prop) { return $null } else { return $prop.Value }
}

function Read-CutoverState($Ctx) {
  if (-not (Test-Path -LiteralPath $Ctx.StateFile)) { return @{ mode = $Ctx.Mode; phases = @{} } }
  $state = ConvertTo-PlainHashtable (Get-Content -LiteralPath $Ctx.StateFile -Raw | ConvertFrom-Json)
  if ($state.mode -ne $Ctx.Mode) { throw "The work folder belongs to a $($state.mode) run; use another -WorkDir." }
  if ($null -eq $state.phases) { $state.phases = @{} }
  return $state
}

function Save-CutoverState($Ctx) {
  $Ctx.State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Ctx.StateFile -Encoding UTF8
}

function Test-PhaseDone($Ctx, [string]$Phase) {
  $p = $Ctx.State.phases[$Phase]
  return ($null -ne $p -and $p.status -eq "ok")
}

# Runs the phases in order. A phase already "ok" is skipped (resume). The first failure stops the
# plan; in Live mode, once stop-old has started, the rollback runs at once unless -NoAutoRollback.
function Invoke-CutoverPlan($Ctx, [string[]]$Phases, [switch]$NoAutoRollback) {
  # A rolled-back run is over: its ledger, backup and import belong to a live system that kept
  # working afterwards. A new cutover starts in a new work folder and redoes every phase.
  if ($Ctx.State.ContainsKey("rolledBackAt")) { throw "Refused: this work folder was rolled back at $((Get-StateValue $Ctx "rolledBackAt")); start a new cutover with a new -WorkDir." }
  foreach ($phase in $Phases) {
    if (-not ($script:CutoverPhases -contains $phase)) { throw "Unknown phase $phase." }
    if (Test-PhaseDone $Ctx $phase) {
      Write-CutoverLog $Ctx ([ordered]@{ event = "cutover.phase"; phase = $phase; status = "already_done" })
      continue
    }
    $started = Get-Date
    $Ctx.State.phases[$phase] = @{ status = "running"; startedAt = (Get-UtcStamp) }
    Save-CutoverState $Ctx
    $detail = $null
    $failure = $null
    try {
      $detail = & "Invoke-Phase-$phase" $Ctx
    } catch {
      $failure = $_.Exception.Message
    }
    $seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
    $status = "ok"
    if ($null -ne $failure) { $status = "failed" }
    $Ctx.State.phases[$phase] = @{ status = $status; startedAt = $Ctx.State.phases[$phase].startedAt; endedAt = (Get-UtcStamp); seconds = $seconds }
    Save-CutoverState $Ctx
    $entry = [ordered]@{ event = "cutover.phase"; phase = $phase; status = $status; seconds = $seconds }
    if ($null -ne $detail) { $entry.detail = $detail }
    if ($null -ne $failure) { $entry.reason = $failure }
    Write-CutoverLog $Ctx $entry
    if ($null -ne $failure) {
      $stopStarted = $null -ne $Ctx.State.phases["stop-old"]
      if ($Ctx.Mode -eq "Live" -and $stopStarted -and -not $NoAutoRollback) {
        Write-CutoverLog $Ctx ([ordered]@{ event = "cutover.abort"; phase = $phase; action = "rollback" })
        Invoke-CutoverRollback $Ctx "phase_failed:$phase"
      } else {
        Write-CutoverLog $Ctx ([ordered]@{ event = "cutover.abort"; phase = $phase; action = "stop" })
      }
      return $false
    }
  }
  return $true
}

# Runs a server script under apps\server with node and tsx, with the step's environment. stdout
# goes to a file and its last line is parsed as the step's JSON answer; stderr (log lines) goes to
# a file in the work folder. Returns @{ code; line }.
function Invoke-CutoverNode($Ctx, [string]$Script, [string[]]$Arguments, [string]$Name) {
  $node = $Ctx.Node
  if ($null -eq $node) { $node = Get-NodePath }
  $out = Join-Path $Ctx.WorkDir "$Name.out.log"
  $err = Join-Path $Ctx.WorkDir "$Name.err.log"
  $quoted = @("--import", "tsx", "`"$Script`"") + @($Arguments | ForEach-Object { "`"$_`"" })
  $saved = @{}
  foreach ($key in $Ctx.StepEnv.Keys) {
    $saved[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
    [Environment]::SetEnvironmentVariable($key, $Ctx.StepEnv[$key], "Process")
  }
  try {
    # Not -Wait: it also waits for every descendant, and `host start` leaves the server running.
    $process = Start-Process -FilePath $node -ArgumentList $quoted -WorkingDirectory (Join-Path $Ctx.Root "apps\server") -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    $null = $process.Handle
    $process.WaitForExit()
  } finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], "Process") }
  }
  $line = $null
  $last = Get-Content -LiteralPath $out -ErrorAction SilentlyContinue | Where-Object { $_.Trim().StartsWith("{") } | Select-Object -Last 1
  if ($null -ne $last) { $line = ConvertTo-PlainHashtable ($last | ConvertFrom-Json) }
  return @{ code = [int]$process.ExitCode; line = $line }
}

function Invoke-CutoverStep($Ctx, [string[]]$Arguments) {
  $script = Join-Path $Ctx.Root "apps\server\src\cutover\run-cutover-step.ts"
  return Invoke-CutoverNode $Ctx $script $Arguments "step-$($Arguments[0])"
}

function Assert-LiveMode($Ctx, [string]$What) {
  if ($Ctx.Mode -ne "Live") { throw "Refused: a rehearsal never $What." }
}

function Assert-CutoverLiveTask($Ctx, [string]$Name) {
  Assert-LiveMode $Ctx "touches a live task"
  if (-not ($script:CutoverLiveTasks -contains $Name)) { throw "Refused: $Name is not a live task the cutover stops." }
}

function Stop-CutoverLiveTask($Ctx, [string]$Name) {
  Assert-CutoverLiveTask $Ctx $Name
  Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  Disable-ScheduledTask -TaskName $Name | Out-Null
}

function Start-CutoverLiveTask($Ctx, [string]$Name) {
  Assert-CutoverLiveTask $Ctx $Name
  Enable-ScheduledTask -TaskName $Name | Out-Null
  Start-ScheduledTask -TaskName $Name
}

function Get-ListeningPorts([int[]]$Ports) {
  return @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $Ports -contains $_.LocalPort })
}

function Wait-Until([scriptblock]$Condition, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Condition) { return $true }
    Start-Sleep -Seconds 2
  }
  return [bool](& $Condition)
}

function Test-HttpOk([string]$Url) {
  try {
    $answer = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    return ($answer.StatusCode -eq 200)
  } catch {
    return $false
  }
}

# The ledger file the server of an environment opens, from its config (`cutover:step ledger-path`).
function Get-ConfiguredLedger($Ctx, [string]$Environment) {
  $answer = Invoke-CutoverStep $Ctx @("ledger-path", "--env", $Environment)
  if ($answer.code -ne 0 -or $null -eq $answer.line) { throw "ledger_path_unknown" }
  return [string]$answer.line.ledger
}

# The window in which a rollback is still offered: 72 hours after the new system went live.
function Test-InsideWindow($Ctx) {
  $goLive = (Get-StateValue $Ctx "goLiveAt")
  if ($null -eq $goLive) { return $true }
  if ($goLive -is [DateTime]) { $start = $goLive.ToUniversalTime() }
  else { $start = [DateTime]::Parse([string]$goLive, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal) }
  $end = $start.AddHours($script:CutoverWindowHours)
  return ((Get-Date).ToUniversalTime() -lt $end)
}
