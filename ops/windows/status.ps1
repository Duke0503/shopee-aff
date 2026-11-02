# Shows the new platform's state on the VPS (Story 8.5): its three tasks, the cloudflared service,
# the processes behind the recorded PIDs, and the tunnel check (only the public listener exposed).
# Read-only: it starts, stops and changes nothing.

param(
  [ValidateSet("prod")]
  [string]$Environment = "prod",
  [string]$TunnelConfig = ""
)

. (Join-Path $PSScriptRoot "common.ps1")

$root = Get-RepositoryRoot

foreach ($name in Get-OwnTaskNames) {
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($null -eq $task) { Write-Output "task $name : not installed"; continue }
  $info = Get-ScheduledTaskInfo -TaskName $name
  Write-Output ("task {0} : {1}, last run {2}, last result {3}" -f $name, $task.State, $info.LastRunTime, $info.LastTaskResult)
}

$tunnel = Get-Service -Name cloudflared -ErrorAction SilentlyContinue
if ($null -eq $tunnel) { Write-Output "service cloudflared : not installed" }
else { Write-Output ("service cloudflared : {0}, start type {1}" -f $tunnel.Status, $tunnel.StartType) }

$code = Invoke-Host $root @("status", "--env", $Environment)

if ($TunnelConfig -eq "") {
  $candidates = @(
    (Join-Path $env:USERPROFILE ".cloudflared\config.yml"),
    "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml",
    "C:\ProgramData\cloudflared\config.yml"
  )
  $TunnelConfig = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if ($TunnelConfig) {
  $tunnelCode = Invoke-Host $root @("tunnel-check", "--config", $TunnelConfig)
  if ($tunnelCode -ne 0) { $code = $tunnelCode }
} else {
  Write-Output "tunnel config : not found (pass -TunnelConfig <path>)"
}
exit $code
