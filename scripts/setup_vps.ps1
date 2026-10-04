# =====================================================================
# SCRIPT TỰ ĐỘNG CÀI ĐẶT MÔI TRƯỜNG CHO VPS WINDOWS SERVER 2022
# Dự án: Hệ Thống Hoàn Tiền MMO & Zalo Bot Assistant
# =====================================================================

param(
    [string]$GitToken = $env:GITHUB_TOKEN
)

$ErrorActionPreference = "Continue"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "🚀 ĐANG CÀI ĐẶT MÔI TRƯỜNG TỰ ĐỘNG CHO VPS HOÀN TIỀN DP..." -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. TẮT BẢO MẬT PHIỀN TOÁI CỦA INTERNET EXPLORER TRÊN WINDOWS SERVER
Write-Host "`n[1/5] Đang tối ưu cài đặt bảo mật trình duyệt Windows Server..." -ForegroundColor Yellow
try {
    Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Active Setup\Installed Components\{A509B1A7-37EF-4b3f-8CFC-4F3A74704073}" -Name "IsInstalled" -Value 0 -ErrorAction SilentlyContinue
    Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Active Setup\Installed Components\{A509B1A8-37EF-4b3f-8CFC-4F3A74704073}" -Name "IsInstalled" -Value 0 -ErrorAction SilentlyContinue
    Write-Host " -> Đã tắt IE Enhanced Security Configuration thành công." -ForegroundColor Green
} catch {}

# 2. CÀI ĐẶT GOOGLE CHROME (BẮT BUỘC ĐỂ CHẠY EXTENSION VÀ GIẢI CAPTCHA)
Write-Host "`n[2/5] Đang tải và cài đặt Google Chrome mới nhất..." -ForegroundColor Yellow
$chromeInstaller = "$env:TEMP\ChromeSetup.exe"
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "https://dl.google.com/chrome/install/latest/chrome_installer.exe" -OutFile $chromeInstaller
    Start-Process -FilePath $chromeInstaller -Args "/silent /install" -Wait
    Remove-Item $chromeInstaller -Force -ErrorAction SilentlyContinue
    Write-Host " -> Đã cài đặt Google Chrome thành công." -ForegroundColor Green
} catch {
    Write-Host " -> Lỗi cài Chrome tự động: $_" -ForegroundColor Red
}

# 3. CÀI ĐẶT NODE.JS v20 LTS
Write-Host "`n[3/5] Đang tải và cài đặt Node.js v20 LTS..." -ForegroundColor Yellow
$nodeInstaller = "$env:TEMP\node-v20.msi"
try {
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi" -OutFile $nodeInstaller
    Start-Process msiexec.exe -Args "/i `"$nodeInstaller`" /qn" -Wait
    Remove-Item $nodeInstaller -Force -ErrorAction SilentlyContinue
    Write-Host " -> Đã cài đặt Node.js v20 thành công." -ForegroundColor Green
} catch {
    Write-Host " -> Lỗi cài Node.js: $_" -ForegroundColor Red
}

# 4. CÀI ĐẶT ASTRAL UV (TRÌNH QUẢN LÝ PYTHON SIÊU TỐC)
Write-Host "`n[4/5] Đang cài đặt uv (Python package manager)..." -ForegroundColor Yellow
try {
    powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
    Write-Host " -> Đã cài đặt uv thành công." -ForegroundColor Green
} catch {
    Write-Host " -> Lỗi cài uv: $_" -ForegroundColor Red
}

# 5. CÀI ĐẶT GIT FOR WINDOWS
Write-Host "`n[5/7] Đang tải và cài đặt Git for Windows..." -ForegroundColor Yellow
$gitInstaller = "$env:TEMP\Git-Installer.exe"
try {
    Invoke-WebRequest -Uri "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe" -OutFile $gitInstaller
    Start-Process -FilePath $gitInstaller -Args "/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS" -Wait
    Remove-Item $gitInstaller -Force -ErrorAction SilentlyContinue
    Write-Host " -> Đã cài đặt Git for Windows thành công." -ForegroundColor Green
} catch {
    Write-Host " -> Lỗi cài Git: $_" -ForegroundColor Red
}

# 6. CÀI ĐẶT CLOUDFLARE TUNNEL (CLOUDFLARED)
Write-Host "`n[6/7] Đang tải và cài đặt Cloudflare Tunnel..." -ForegroundColor Yellow
try {
    $cloudflaredDir = "C:\Program Files\cloudflared"
    if (-not (Test-Path $cloudflaredDir)) {
        New-Item -ItemType Directory -Force -Path $cloudflaredDir | Out-Null
    }
    Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile "$cloudflaredDir\cloudflared.exe"
    
    $currentPath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    if ($currentPath -notlike "*cloudflared*") {
        [System.Environment]::SetEnvironmentVariable("Path", "$currentPath;$cloudflaredDir", "Machine")
    }
    Write-Host " -> Đã cài đặt cloudflared thành công." -ForegroundColor Green
} catch {
    Write-Host " -> Lỗi cài cloudflared: $_" -ForegroundColor Red
}

# CẬP NHẬT BIẾN PATH CHO PHIÊN LÀM VIỆC HIỆN TẠI
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User") + ";C:\Users\Administrator\.local\bin;C:\Program Files\Git\cmd;C:\Program Files\nodejs"

# 7. TỰ ĐỘNG CLONE DỰ ÁN QUA GIT ACCESS TOKEN NẾU CHƯA CÓ
$projectDir = "C:\Project\mmo"
if (-not (Test-Path "$projectDir\.git")) {
    Write-Host "`n[7/7] Đang Clone dự án từ GitHub về $projectDir..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path "C:\Project" | Out-Null
    if ($GitToken) {
        git clone "https://$GitToken@github.com/Duke0503/shopee-aff.git" $projectDir
    } else {
        git clone "https://github.com/Duke0503/shopee-aff.git" $projectDir
    }
    Write-Host " -> Đã Clone mã nguồn từ GitHub thành công!" -ForegroundColor Green
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "🎉 HOÀN TẤT CÀI ĐẶT MÔI TRƯỜNG & MÃ NGUỒN TRÊN VPS!" -ForegroundColor Green
Write-Host "Các công cụ đã sẵn sàng: Chrome, Node.js, Python uv, Git, Cloudflared" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
