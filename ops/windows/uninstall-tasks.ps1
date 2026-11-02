# Removes the new platform's three tasks (Story 8.5), for a rollback or a reinstall. Stop first
# with stop.ps1. Removes only the tasks named in common.ps1; the live tasks are refused.

. (Join-Path $PSScriptRoot "common.ps1")

Assert-Elevated
foreach ($name in Get-OwnTaskNames) {
  Assert-OwnTask $name
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    Write-Output "removed $name"
  }
}
