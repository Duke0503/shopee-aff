# Shared by the production host scripts of the new platform (Story 8.5, AD-25, D61).
#
# The new system runs on the Windows VPS beside the live one (C:\Project\mmo, tasks
# CashbackBackend and CashbackAssistant) until cutover switches the tunnel. These scripts know only
# their own three tasks below and refuse any other name, so they can never change, stop or remove
# a live task. Processes are never found by name: every start and stop goes through
# `pnpm host` (apps/server/src/host/run-host.ts), which acts only on the PIDs it recorded in
# run\<env>\<role>.pid. The env file is %USERPROFILE%\.config\cashback\<env>.env, outside the
# repository; no script reads a secret.

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

$script:OwnTasks = [ordered]@{
  server    = "CashbackV2Server"
  assistant = "CashbackV2Assistant"
  browser   = "CashbackV2Browser"
}

# The live system's tasks: named here only so the guard below can refuse them.
$script:LiveTasks = @("CashbackBackend", "CashbackAssistant")

$script:LiveFolder = "C:\Project\mmo"

function Get-RepositoryRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Assert-OwnTask([string]$Name) {
  if ($script:LiveTasks -contains $Name) { throw "Refused: $Name is a live system task." }
  if (-not ($script:OwnTasks.Values -contains $Name)) { throw "Refused: $Name is not a task of the new platform." }
}

function Get-OwnTaskNames {
  return @($script:OwnTasks.Values)
}

function Assert-NotLiveFolder([string]$Root) {
  $full = [System.IO.Path]::GetFullPath($Root).TrimEnd("\")
  $live = [System.IO.Path]::GetFullPath($script:LiveFolder).TrimEnd("\")
  if ($full -ieq $live -or $full.StartsWith("$live\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refused: the new platform must not be installed inside the live folder $live."
  }
}

function Get-EnvFilePath([string]$Environment) {
  return Join-Path $env:USERPROFILE ".config\cashback\$Environment.env"
}

function Assert-EnvFileOutsideRepository([string]$Environment, [string]$Root) {
  $file = Get-EnvFilePath $Environment
  if (-not (Test-Path -LiteralPath $file)) { throw "The env file $file does not exist. Create it from the runbook first." }
  $full = [System.IO.Path]::GetFullPath($file)
  $repo = [System.IO.Path]::GetFullPath($Root).TrimEnd("\")
  if ($full.StartsWith("$repo\", [System.StringComparison]::OrdinalIgnoreCase)) { throw "Refused: the env file must live outside the repository." }
}

function Get-NodePath {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -eq $node) { throw "node.exe is not on PATH." }
  return $node.Source
}

# The arguments of `node --import tsx run-host.ts <command...>`, run from apps\server.
function Get-HostArguments([string]$Root, [string[]]$Command) {
  $runHost = Join-Path $Root "apps\server\src\host\run-host.ts"
  return @("--import", "tsx", "`"$runHost`"") + $Command
}

# Runs `pnpm host <command>`: node's output goes to the console (never into the return value),
# and the function returns only node's exit code, as an int.
function Invoke-Host([string]$Root, [string[]]$Command) {
  $node = Get-NodePath
  Push-Location (Join-Path $Root "apps\server")
  try {
    & $node --import tsx (Join-Path $Root "apps\server\src\host\run-host.ts") @Command | Out-Host
    return [int]$LASTEXITCODE
  } finally {
    Pop-Location
  }
}

function Assert-Elevated {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated PowerShell (Run as administrator)."
  }
}
