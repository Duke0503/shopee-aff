# Registers the new platform's three Task Scheduler tasks on the production VPS (Story 8.5, D61).
# Run once by the owner, from an elevated PowerShell, after the steps before it in
# docs/operations/production-host-runbook.md. Never run by tests or CI.
#
#   CashbackV2Server     at startup, then every 5 minutes (ignored while running): pnpm host run server
#   CashbackV2Assistant  at startup, then every 5 minutes (ignored while running): pnpm host run assistant
#   CashbackV2Browser    at log-on of the operator (after Windows auto-logon):     pnpm host run browser
#
# The server and assistant tasks run whether the operator is signed in or not (S4U: no password
# is stored), at the lowest run level. The browser task runs in the signed-in desktop session, so
# the affiliate Edge has a window. Each task stays running as long as its process, so the repeat
# trigger restarts only a process that died; a crash fails the task and its restart settings
# apply. The live tasks CashbackBackend and CashbackAssistant are never touched.
#
# Before registering, `pnpm host check` must pass (env file, production settings, secrets rotated,
# tunnel). -AllowGaps registers anyway for the shadow run before go-live, when some production
# settings are still empty.

param(
  [ValidateSet("prod")]
  [string]$Environment = "prod",
  [string]$TunnelConfig = "",
  [switch]$AllowGaps
)

. (Join-Path $PSScriptRoot "common.ps1")

Assert-Elevated
$root = Get-RepositoryRoot
Assert-NotLiveFolder $root
Assert-EnvFileOutsideRepository $Environment $root

$check = @("check", "--env", $Environment)
if ($TunnelConfig -ne "") { $check += @("--tunnel-config", $TunnelConfig) }
$code = Invoke-Host $root $check
if ($code -ne 0 -and -not $AllowGaps) { throw "pnpm host check failed (exit $code). Fix what it names, or pass -AllowGaps for the shadow run." }

$node = Get-NodePath
$user = "$env:USERDOMAIN\$env:USERNAME"
$serverDir = Join-Path $root "apps\server"

function New-OwnAction([string]$Role) {
  $arguments = (Get-HostArguments $root @("run", $Role, "--env", $Environment)) -join " "
  return New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $serverDir
}

function New-OwnSettings {
  # No time limit: the task runs as long as its process. Restart a failed run three times, a minute apart.
  return New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
}

function Register-OwnTask([string]$Name, $Action, $Triggers, $Principal, [string]$Description) {
  Assert-OwnTask $Name
  Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Triggers -Principal $Principal -Settings (New-OwnSettings) -Description $Description -Force | Out-Null
  Write-Output "registered $Name"
}

function New-BootTriggers {
  $boot = New-ScheduledTaskTrigger -AtStartup
  $boot.Delay = "PT1M"
  $watch = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5)
  return @($boot, $watch)
}

$background = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
$desktop = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$logon = New-ScheduledTaskTrigger -AtLogOn -User $user
$logon.Delay = "PT30S"

Register-OwnTask $OwnTasks.server (New-OwnAction "server") (New-BootTriggers) $background "New cashback platform server (Story 8.5). Stop with ops\windows\stop.ps1."
Register-OwnTask $OwnTasks.assistant (New-OwnAction "assistant") (New-BootTriggers) $background "New cashback platform Zalo assistant (Story 8.5). Stop with ops\windows\stop.ps1."
Register-OwnTask $OwnTasks.browser (New-OwnAction "browser") @($logon) $desktop "New cashback platform affiliate Edge, own profile and the new bridge extension (Story 8.5)."

Write-Output "Done. Start now with ops\windows\start.ps1, or reboot to test the boot path."
