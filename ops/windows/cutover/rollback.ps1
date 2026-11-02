# Rolls the cutover back to the live system (Story 8.8 AC4): stops the new platform's tasks, gives
# port 80 back, restores the machine PATH with Node 20, restarts CashbackBackend and
# CashbackAssistant and the GitHub runner service as they were before the cutover. Offered only
# inside the 72-hour window after go-live; afterwards it refuses, the new system is final. The
# time is recorded in <WorkDir>\cutover-state.json and the log. See go-live-runbook.md section 7.
#
#   .\ops\windows\cutover\rollback.ps1 -WorkDir C:\Project\cutover -Reason "smoke failed"

param(
  [Parameter(Mandatory = $true)]
  [string]$WorkDir,
  [Parameter(Mandatory = $true)]
  [string]$Reason,
  [ValidateSet("Rehearsal", "Live")]
  [string]$Mode = "Live",
  [int]$PublicPort = 80
)

. (Join-Path $PSScriptRoot "cutover-common.ps1")
. (Join-Path $PSScriptRoot "cutover-phases.ps1")
. (Join-Path $PSScriptRoot "cutover-switch.ps1")

if (-not (Test-Path -LiteralPath (Join-Path $WorkDir "cutover-state.json"))) { throw "No cutover state in $WorkDir." }
$ctx = New-CutoverContext $Mode $WorkDir
$ctx.PublicPort = $PublicPort
if ($Mode -eq "Live") { Assert-Elevated }
$ctx.RehearsalHome = Join-Path $ctx.WorkDir "home"
if ($Mode -eq "Rehearsal") { $ctx.StepEnv = @{ CASHBACK_ENV = "dev"; USERPROFILE = $ctx.RehearsalHome; HOME = $ctx.RehearsalHome } }
Invoke-CutoverRollback $ctx $Reason
exit 0
