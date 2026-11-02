# The cutover from the live system to the new platform (Stories 8.7 and 8.8; AD-24, D40, D61).
# Follow docs/operations/go-live-runbook.md; never run Live mode outside it.
#
#   Rehearsal (default, the operator's machine, a copy of the live database):
#     .\ops\windows\cutover\cutover.ps1 -LiveCopy C:\copies\live-copy.db -WorkDir C:\copies\rehearsal-1
#   Live (the VPS, elevated PowerShell, after the old extension was removed):
#     .\ops\windows\cutover\cutover.ps1 -Mode Live -WorkDir C:\Project\cutover -Node24Dir C:\Tools\node-v24 -ConfirmOldExtensionRemoved [-AcceptGaps "ADMIN_HOST,ACCESS_TEAM_DOMAIN,ACCESS_AUDIENCE"]
#
# Phases, in order: preflight, stop-old, final-backup, import, parity, first-run, carry-over,
# start-new, smoke. Each logs one JSON line and is recorded in <WorkDir>\cutover-state.json; run
# the same command again to resume at the first phase not done. -Phase runs phases up to and
# including the named one (for example `-Phase preflight` in the afternoon). Any failure after
# stop-old in Live mode rolls back at once (rollback.ps1 does the same by hand).

param(
  [ValidateSet("Rehearsal", "Live")]
  [string]$Mode = "Rehearsal",
  [Parameter(Mandatory = $true)]
  [string]$WorkDir,
  [string]$LiveCopy = "",
  [string]$Node24Dir = "",
  [string]$AcceptGaps = "",
  [switch]$ConfirmOldExtensionRemoved,
  [string]$Phase = "",
  [string]$ShopeeReport = "",
  [string]$ShopeeMapping = "",
  [string]$AccesstradeReport = "",
  [string]$PublicHost = "hoantiendp.com",
  [int]$PublicPort = 80,
  [int]$RehearsalPort = 9180,
  [int]$SampleSize = 20,
  [int]$PlannedDowntimeMinutes = 45,
  [switch]$NoAutoRollback
)

. (Join-Path $PSScriptRoot "cutover-common.ps1")
. (Join-Path $PSScriptRoot "cutover-phases.ps1")
. (Join-Path $PSScriptRoot "cutover-switch.ps1")

$ctx = New-CutoverContext $Mode $WorkDir
$ctx.LiveDb = Join-Path $script:LiveFolder "cashback.db"
$ctx.LiveEnv = Join-Path $script:LiveFolder ".env"
$ctx.LiveCredentials = Join-Path $script:LiveFolder "zalo_assistant\credentials.json"
$ctx.LiveCopy = $LiveCopy
$ctx.Node24Dir = $Node24Dir
$ctx.AcceptGaps = $AcceptGaps
$ctx.ConfirmOldExtensionRemoved = [bool]$ConfirmOldExtensionRemoved
$ctx.ShopeeReport = $ShopeeReport
$ctx.ShopeeMapping = $ShopeeMapping
$ctx.AccesstradeReport = $AccesstradeReport
$ctx.PublicHost = $PublicHost
$ctx.PublicPort = $PublicPort
$ctx.RehearsalPort = $RehearsalPort
$ctx.SampleSize = $SampleSize
$ctx.RehearsalHome = Join-Path $ctx.WorkDir "home"

if ($Mode -eq "Rehearsal") {
  if ($LiveCopy -eq "" -or -not (Test-Path -LiteralPath $LiveCopy)) { throw "Give -LiveCopy, the copy of the live database to rehearse on." }
  $ctx.LiveCopy = (Resolve-Path $LiveCopy).Path
  if ($ctx.LiveCopy.StartsWith("$($script:LiveFolder)\", [StringComparison]::OrdinalIgnoreCase)) { throw "Refused: a rehearsal reads a copy, never the live folder." }
  $ctx.StepEnv = @{ CASHBACK_ENV = "dev"; USERPROFILE = $ctx.RehearsalHome; HOME = $ctx.RehearsalHome }
  $ctx.Node = Get-NodePath
} else {
  if ($Node24Dir -eq "" -or -not (Test-Path -LiteralPath (Join-Path $Node24Dir "node.exe"))) { throw "Give -Node24Dir, the folder of the portable Node 24 (node.exe)." }
  $ctx.StepEnv = @{ CASHBACK_ENV = "prod" }
  $ctx.Node = Join-Path $Node24Dir "node.exe"
}

$phases = $script:CutoverPhases
if ($Phase -ne "") {
  $at = [array]::IndexOf($script:CutoverPhases, $Phase)
  if ($at -lt 0) { throw "Unknown phase $Phase. Phases: $($script:CutoverPhases -join ', ')" }
  $phases = $script:CutoverPhases[0..$at]
}

Write-CutoverLog $ctx ([ordered]@{ event = "cutover.start"; phases = $phases; workDir = $ctx.WorkDir })
$ok = Invoke-CutoverPlan $ctx $phases -NoAutoRollback:$NoAutoRollback
$complete = $ok -and ($phases.Count -eq $script:CutoverPhases.Count)
if ($Mode -eq "Rehearsal") { Stop-RehearsalServer $ctx $complete }
$verdict = Write-GoNoGo $ctx $complete $PlannedDowntimeMinutes
Write-CutoverLog $ctx ([ordered]@{ event = "cutover.end"; ok = $ok; complete = $complete; verdict = $verdict; checklist = (Join-Path $ctx.WorkDir "go-no-go.md") })
if (-not $ok) { exit 1 }
exit 0
