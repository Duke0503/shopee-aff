# Stops the new platform on the VPS (Story 8.5): first disables its three tasks, so their repeat
# trigger cannot start anything again, then stops the processes by the PIDs `pnpm host` recorded:
# the server in order through its internal shutdown route, the assistant and Edge by their PID.
# No process is found by name, and the live tasks and the live browser are never touched. The
# tasks stay disabled until start.ps1.

param(
  [ValidateSet("prod")]
  [string]$Environment = "prod"
)

. (Join-Path $PSScriptRoot "common.ps1")

$root = Get-RepositoryRoot
Assert-NotLiveFolder $root

foreach ($name in Get-OwnTaskNames) {
  Assert-OwnTask $name
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Disable-ScheduledTask -TaskName $name | Out-Null
    Write-Output "disabled $name"
  }
}
$code = Invoke-Host $root @("stop", "all", "--env", $Environment)
exit $code
