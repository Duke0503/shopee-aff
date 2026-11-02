# Deploys the new platform on the production VPS from a checked-out copy of the repository (the
# GitHub Actions workspace of .github/workflows/deploy.yml, or any clean checkout). Builds first,
# while production still runs; then stops the tasks, mirrors the code into C:\Project\cashback,
# installs, starts, and checks health and that exactly one Zalo assistant runs. Data, run files,
# the browser profile and the extension's deployed settings are never touched.
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [string]$Root = "C:\Project\cashback",
  [string]$NodeDir = "C:\Tools\node-v24"
)
$ErrorActionPreference = "Stop"
$env:Path = "$NodeDir;" + $env:Path
$pnpm = Join-Path $NodeDir "pnpm.cmd"

function Step([string]$Name) { Write-Host ">>> $Name" }
function Must([string]$What) { if ($LASTEXITCODE -ne 0) { throw "$What failed ($LASTEXITCODE)" } }

Step "build in $Source"
Set-Location $Source
& $pnpm install --frozen-lockfile; Must "install (build copy)"
foreach ($app in "@cashback/web", "@cashback/admin", "@cashback/bridge") { & $pnpm --filter $app build; Must "build $app" }

$bridgeConfig = Join-Path $Root "apps\bridge\dist\bridge-config.json"
$kept = if (Test-Path $bridgeConfig) { Get-Content -LiteralPath $bridgeConfig -Raw } else { $null }

Step "stop production"
& (Join-Path $Root "ops\windows\stop.ps1")

Step "mirror code into $Root"
robocopy $Source $Root /MIR /XD node_modules .git data run .browser-profile /XF bridge-config.json /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copy failed ($LASTEXITCODE)" }
if ($null -ne $kept) { [IO.File]::WriteAllText($bridgeConfig, $kept) }

Step "install in $Root"
Set-Location $Root
& $pnpm install --frozen-lockfile; Must "install (production)"

Step "start production"
& (Join-Path $Root "ops\windows\start.ps1")

$healthy = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep 3
  try { if ((Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:80/api/health" -TimeoutSec 3).StatusCode -eq 200) { $healthy = $true; break } } catch { }
}
if (-not $healthy) { throw "health check failed after start" }

Start-Sleep 45
$assistants = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'apps\\assistant\\src\\main\.ts' })
Write-Host "assistant processes: $($assistants.Count)"
if ($assistants.Count -ne 1) { throw "expected exactly one Zalo assistant, found $($assistants.Count)" }
Write-Host ">>> deployed and healthy"
