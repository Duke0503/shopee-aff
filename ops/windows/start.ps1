# Starts the new platform on the VPS (Story 8.5): enables its three tasks and starts them. The
# browser task starts only in the operator's signed-in desktop session. Each task runs
# `pnpm host run <role>`, which starts nothing when its recorded process is already running.

param(
  [ValidateSet("prod")]
  [string]$Environment = "prod",
  [switch]$NoBrowser
)

. (Join-Path $PSScriptRoot "common.ps1")

$root = Get-RepositoryRoot
Assert-NotLiveFolder $root
Assert-EnvFileOutsideRepository $Environment $root

foreach ($role in $OwnTasks.Keys) {
  $name = $OwnTasks[$role]
  Assert-OwnTask $name
  Enable-ScheduledTask -TaskName $name | Out-Null
  if ($role -eq "browser" -and $NoBrowser) { continue }
  Start-ScheduledTask -TaskName $name
  Write-Output "started $name"
}
Write-Output "Check with ops\windows\status.ps1 in a minute."
