# The cleanup after the 72-hour window (Story 8.8, owner decision of 2026-11-02). Run only after
# the go decision and after `pnpm payout:window off` closed the no-payout window. Without -Apply it
# prints the plan and changes nothing. With -Apply, in this order:
#   1. archive C:\Project\mmo (the old ledger cashback.db inside) and the cutover's reports and
#      final backup into <ArchiveDir>, and check that the archive holds cashback.db;
#   2. remove the live tasks CashbackBackend and CashbackAssistant;
#   3. delete the GitHub runner service and its folder (then remove the runner in GitHub, runbook);
#   4. remove the Node 20 folder the cutover took off the PATH;
#   5. remove the cutover work folder and C:\Project\mmo.
# It refuses inside the window, after a rollback, and while the payout window is still open.

param(
  [Parameter(Mandatory = $true)]
  [string]$WorkDir,
  [string]$ArchiveDir = "C:\Archive",
  [switch]$Apply
)

. (Join-Path $PSScriptRoot "cutover-common.ps1")

$ctx = New-CutoverContext "Live" $WorkDir
$ctx.Node = Get-NodePath
$ctx.StepEnv = @{ CASHBACK_ENV = "prod" }
if ($null -eq $ctx.State.goLiveAt) { throw "Refused: the cutover state has no go-live time." }
if ($ctx.State.ContainsKey("rolledBackAt")) { throw "Refused: this cutover was rolled back." }
if (Test-InsideWindow $ctx) { throw "Refused: the 72-hour window has not ended; rollback must stay possible." }

$ledger = Get-ConfiguredLedger $ctx "prod"
$flags = Invoke-CutoverStep $ctx @("flags", $ledger)
if ($null -eq $flags.line -or $flags.line.payoutWindowOpen -ne $false) { throw "Refused: the payout window is still open; run pnpm payout:window off first." }

$stamp = (Get-Date).ToString("yyyyMMdd")
$zip = Join-Path $ArchiveDir "mmo-$stamp.zip"
$reports = Join-Path $ArchiveDir "cutover-$stamp"
$runner = $null
if ($null -ne $ctx.State.runner) {
  $service = Get-CimInstance Win32_Service -Filter "Name='$($ctx.State.runner.name)'" -ErrorAction SilentlyContinue
  if ($null -ne $service) { $runner = @{ name = $service.Name; folder = Split-Path -Parent (Split-Path -Parent ($service.PathName.Trim('"') -replace '"\s.*$', '')) } }
}
$node20 = $ctx.State.node20Dir
$plan = [ordered]@{ archive = $zip; reports = $reports; removeTasks = $script:CutoverLiveTasks; runner = $runner; node20 = $node20; removeFolders = @($ctx.WorkDir, $script:LiveFolder) }
Write-CutoverLog $ctx ([ordered]@{ event = "cutover.cleanup.plan"; apply = [bool]$Apply; plan = $plan })
if (-not $Apply) { exit 0 }
Assert-Elevated

New-Item -ItemType Directory -Force -Path $ArchiveDir, $reports | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (-not (Test-Path -LiteralPath $zip)) { [System.IO.Compression.ZipFile]::CreateFromDirectory($script:LiveFolder, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $true) }
$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
$hasDb = @($archive.Entries | Where-Object { $_.FullName -match '(^|[\\/])cashback\.db$' }).Count -gt 0
$archive.Dispose()
if (-not $hasDb) { throw "The archive does not hold cashback.db; nothing was removed." }
Get-ChildItem -LiteralPath $ctx.WorkDir -File | Where-Object { $_.Extension -in ".json", ".jsonl", ".md" } | Copy-Item -Destination $reports -Force
Copy-Item -LiteralPath $ctx.FinalDir -Destination $reports -Recurse -Force
Write-CutoverLog $ctx ([ordered]@{ event = "cutover.cleanup.archived"; archive = $zip; reports = $reports })

foreach ($name in $script:CutoverLiveTasks) {
  Assert-CutoverLiveTask $ctx $name
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $name -Confirm:$false }
}
if ($null -ne $runner) {
  Stop-Service -Name $runner.name -ErrorAction SilentlyContinue
  & sc.exe delete $runner.name | Out-Null
  if (Test-Path -LiteralPath $runner.folder) { Remove-Item -LiteralPath $runner.folder -Recurse -Force }
}
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
if ($null -ne $node20 -and (Test-Path -LiteralPath $node20) -and -not (($machinePath -split ";") -contains $node20)) { Remove-Item -LiteralPath $node20 -Recurse -Force }
Remove-Item -LiteralPath $script:LiveFolder -Recurse -Force
Write-CutoverLog $ctx ([ordered]@{ event = "cutover.cleanup.done"; removedTasks = $script:CutoverLiveTasks; runnerRemoved = ($null -ne $runner); node20Removed = ($null -ne $node20) })
# Last: the work folder holds this run's log, already copied into the reports.
Remove-Item -LiteralPath $ctx.WorkDir -Recurse -Force
exit 0
