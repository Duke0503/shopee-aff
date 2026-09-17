# Master launcher for Cashback Bot
# Starts:
# 1. Chrome Automation Browser (with extension)
# 2. Cashback Server (backend + frontend)
# 3. Cloudflare Tunnel (domain hoantiendp.com)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "   KHOI DONG HE THONG HOAN TIEN SHOPEE AFFILIATE " -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# 1. Kiem tra uv
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "[1/4] 'uv' chua duoc cai dat. Dang cai dat qua winget..." -ForegroundColor Yellow
    winget install --id astral-sh.uv --silent --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Host "[1/4] Da tim thay 'uv'." -ForegroundColor Green
}

# 2. Dong bo dependencies
Write-Host "[2/4] Dong bo dependencies Python..." -ForegroundColor Cyan
uv sync

# 3. Kiem tra token extension
$BaseUrlJs = Join-Path $Root "extension\background\base_url.js"
if (-not (Test-Path $BaseUrlJs)) {
    Write-Host "[3/4] Khoi tao token extension lan dau..." -ForegroundColor Yellow
    uv run cashback setup-token
} else {
    Write-Host "[3/4] Token extension da san sang." -ForegroundColor Green
}

# 4. Khoi dong cac tien trinh
Write-Host "[4/4] Dang khoi chay cac dich vu..." -ForegroundColor Cyan

# Service 1: Backend Serve
Write-Host "  -> Khoi chay Cashback Server..." -ForegroundColor Green
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; Write-Host '--- CASHBACK SERVE ---' -ForegroundColor Green; uv run cashback serve"

# Service 2: Browser Automation
Write-Host "  -> Khoi chay Chrome Shopee Automation..." -ForegroundColor Green
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; Write-Host '--- SHOPEE BROWSER ---' -ForegroundColor Yellow; powershell -ExecutionPolicy Bypass -File 'scripts\start-browser.ps1'"

# Service 3: Cloudflare Tunnel
Write-Host "  -> Khoi chay Cloudflare Tunnel..." -ForegroundColor Green
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; Write-Host '--- CLOUDFLARE TUNNEL ---' -ForegroundColor Cyan; powershell -ExecutionPolicy Bypass -File 'scripts\start-tunnel.ps1'"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Green
Write-Host "  TAT CA DICH VU DA DUOC KHOI CHAY THANH CONG!  " -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
Write-Host "Cac cua so dich vu dang chay ngam trong he thong."
Write-Host "Website se tu dong truy cap duoc qua ten mien cua ban."
