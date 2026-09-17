# Launch Cloudflare Tunnel
# Reads CLOUDFLARE_TUNNEL_TOKEN from .env if available,
# otherwise falls back to quick tunnel (trycloudflare.com).

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $Root ".env"

# Locate cloudflared binary
$Cloudflared = @(
  (Get-Command cloudflared -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
  "C:\Program Files\cloudflared\cloudflared.exe",
  "C:\Program Files (x86)\cloudflared\cloudflared.exe",
  "$env:LOCALAPPDATA\Programs\cloudflared\cloudflared.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $Cloudflared) {
  Write-Host "cloudflared is not installed on this machine." -ForegroundColor Yellow
  Write-Host "Installing cloudflared via winget..." -ForegroundColor Cyan
  winget install --id Cloudflare.cloudflared --silent --accept-source-agreements --accept-package-agreements
  $Cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
  if (-not (Test-Path $Cloudflared)) {
    $Cloudflared = "C:\Program Files\cloudflared\cloudflared.exe"
  }
}

if (-not (Test-Path $Cloudflared)) {
  Write-Error "Cannot locate cloudflared.exe. Please install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
}

# Read token from .env
$Token = ""
if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line -match "^CLOUDFLARE_TUNNEL_TOKEN=(.+)$") {
      $Token = $Matches[1].Trim()
    }
  }
}

if ($Token) {
  Write-Host "Starting Cloudflare Tunnel with configured domain token..." -ForegroundColor Green
  & $Cloudflared tunnel run --token $Token
} else {
  Write-Host "No CLOUDFLARE_TUNNEL_TOKEN found in .env." -ForegroundColor Yellow
  Write-Host "Starting quick temporary tunnel on port 80..." -ForegroundColor Cyan
  & $Cloudflared tunnel --url http://localhost:80
}
