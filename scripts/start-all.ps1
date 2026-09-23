# Master launcher for Cashback System
# Starts all core services:
# 1. Cashback Server (Backend API + Web Dashboard on port 8899 & 80, Bridge on 8787)
# 2. Zalo Assistant Bot (24/7 Group & Private chat worker on port 8891)
# 3. Cloudflare Tunnel (Routes hoantiendp.com to port 80)
# 4. Shopee Chrome Automation (Browser with extension to generate official s.shopee.vn links)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "     KHOI DONG TOAN BO HE THONG HOAN TIEN (ALL-IN-ONE)     " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Kiem tra va don dep tien trinh cu neu co de tranh xung dot port
Write-Host "[1/5] Kiem tra va don dep tien trinh cu..." -ForegroundColor Yellow
Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*cashback*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*assistant_worker*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# 2. Kiem tra uv va dong bo moi truong Python
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "[2/5] 'uv' chua duoc cai dat. Dang cai dat qua winget..." -ForegroundColor Yellow
    winget install --id astral-sh.uv --silent --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Host "[2/5] Da tim thay 'uv'." -ForegroundColor Green
}

# 3. Kiem tra token extension
$BaseUrlJs = Join-Path $Root "extension\background\base_url.js"
if (-not (Test-Path $BaseUrlJs)) {
    Write-Host "[3/5] Khoi tao token extension lan dau..." -ForegroundColor Yellow
    uv run cashback setup-token
} else {
    Write-Host "[3/5] Token extension da san sang." -ForegroundColor Green
}

Write-Host "[4/5] Dang khoi chay cac thanh phan he thong..." -ForegroundColor Cyan

# --- DICH VU 1: BACKEND CASHBACK SERVER (Port 8899 & Port 80) ---
Write-Host "  [+] 1. Khoi chay Backend Cashback Server..." -ForegroundColor Green
$BackendCmd = "Set-Location '$Root'; `$Host.UI.RawUI.WindowTitle = '[1] CASHBACK BACKEND (Port 8899 & 80)'; Write-Host '=== CASHBACK BACKEND SERVER (Port 8899 & 80) ===' -ForegroundColor Green; uv run cashback serve"
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", $BackendCmd

Start-Sleep -Seconds 2

# --- DICH VU 2: ZALO ASSISTANT BOT (Port 8891) ---
Write-Host "  [+] 2. Khoi chay Zalo Assistant Bot..." -ForegroundColor Green
$ZaloDir = Join-Path $Root "zalo_assistant"
$ZaloCmd = "Set-Location '$ZaloDir'; `$Host.UI.RawUI.WindowTitle = '[2] ZALO ASSISTANT BOT (Port 8891)'; Write-Host '=== ZALO ASSISTANT BOT (24/7) ===' -ForegroundColor Yellow; node assistant_worker.js"
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", $ZaloCmd

Start-Sleep -Seconds 1

# --- DICH VU 3: CLOUDFLARE TUNNEL (hoantiendp.com) ---
Write-Host "  [+] 3. Khoi chay Cloudflare Tunnel (hoantiendp.com)..." -ForegroundColor Green
$TunnelCmd = "Set-Location '$Root'; `$Host.UI.RawUI.WindowTitle = '[3] CLOUDFLARE TUNNEL (hoantiendp.com)'; Write-Host '=== CLOUDFLARE TUNNEL ===' -ForegroundColor Cyan; powershell -ExecutionPolicy Bypass -File 'scripts\start-tunnel.ps1'"
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", $TunnelCmd

Start-Sleep -Seconds 1

# --- DICH VU 4: CHROME EXTENSION AUTOMATION (Shopee / ShopeeFood Link Gen) ---
Write-Host "  [+] 4. Khoi chay Trinh duyet Shopee Automation..." -ForegroundColor Green
$BrowserCmd = "Set-Location '$Root'; `$Host.UI.RawUI.WindowTitle = '[4] SHOPEE CHROME AUTOMATION'; Write-Host '=== SHOPEE EXTENSION AUTOMATION ===' -ForegroundColor Magenta; powershell -ExecutionPolicy Bypass -File 'scripts\start-browser.ps1'"
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", $BrowserCmd

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "      TAT CA 4 DICH VU DA DUOC KHOI CHAY THANH CONG!       " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  1. Backend Server  : http://127.0.0.1:8899 & http://localhost:80" -ForegroundColor White
Write-Host "  2. Zalo Bot Worker : http://localhost:8891 (Dang lang nghe 24/7)" -ForegroundColor White
Write-Host "  3. Website Public  : https://hoantiendp.com" -ForegroundColor White
Write-Host "  4. Chrome Extension: Tu dong tao link tiep thi Shopee/ShopeeFood" -ForegroundColor White
Write-Host ""
Write-Host "Luu y: Vui long giu cac cua so nay mo hoac thu nho xuong taskbar." -ForegroundColor Yellow
Write-Host "He thong se tu dong van hanh va phuc vu khach hang." -ForegroundColor Green
