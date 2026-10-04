# =====================================================================
# SCRIPT TU DONG CAI DAT MOI TRUONG CHO VPS WINDOWS SERVER 2022
# Du an: He Thong Hoan Tien MMO & Zalo Bot Assistant
# =====================================================================

param(
    [string]$GitToken = $env:GITHUB_TOKEN
)

$ErrorActionPreference = "Continue"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "[HOAN TIEN DP] DANG CAI DAT MOI TRUONG CHO VPS..." -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. TAT BAO MAT INTERNET EXPLORER TREN WINDOWS SERVER
Write-Host "`n[1/9] Toi uu cai dat bao mat trinh duyet Windows Server..." -ForegroundColor Yellow
try {
    Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Active Setup\Installed Components\{A509B1A7-37EF-4b3f-8CFC-4F3A74704073}" -Name "IsInstalled" -Value 0 -ErrorAction SilentlyContinue
    Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Active Setup\Installed Components\{A509B1A8-37EF-4b3f-8CFC-4F3A74704073}" -Name "IsInstalled" -Value 0 -ErrorAction SilentlyContinue
    Write-Host " -> Da tat IE Enhanced Security Configuration." -ForegroundColor Green
} catch {}

# 2. CAI DAT GOOGLE CHROME (BAT BUOC CHO EXTENSION VA GIAI CAPTCHA)
Write-Host "`n[2/9] Dang tai va cai dat Google Chrome moi nhat..." -ForegroundColor Yellow
$chromeInstaller = "$env:TEMP\ChromeSetup.exe"
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "https://dl.google.com/chrome/install/latest/chrome_installer.exe" -OutFile $chromeInstaller
    Start-Process -FilePath $chromeInstaller -Args "/silent /install" -Wait
    Remove-Item $chromeInstaller -Force -ErrorAction SilentlyContinue
    Write-Host " -> Da cai dat Google Chrome thanh cong." -ForegroundColor Green
} catch {
    Write-Host " -> Loi cai Chrome tu dong: $_" -ForegroundColor Red
}

# 3. CAI DAT NODE.JS v20 LTS
Write-Host "`n[3/9] Dang tai va cai dat Node.js v20 LTS..." -ForegroundColor Yellow
$nodeInstaller = "$env:TEMP\node-v20.msi"
try {
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi" -OutFile $nodeInstaller
    Start-Process msiexec.exe -Args "/i `"$nodeInstaller`" /qn" -Wait
    Remove-Item $nodeInstaller -Force -ErrorAction SilentlyContinue
    Write-Host " -> Da cai dat Node.js v20 thanh cong." -ForegroundColor Green
} catch {
    Write-Host " -> Loi cai Node.js: $_" -ForegroundColor Red
}

# 4. CAI DAT ASTRAL UV (PYTHON PACKAGE MANAGER)
Write-Host "`n[4/9] Dang cai dat uv (Python package manager)..." -ForegroundColor Yellow
try {
    powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
    Write-Host " -> Da cai dat uv thanh cong." -ForegroundColor Green
} catch {
    Write-Host " -> Loi cai uv: $_" -ForegroundColor Red
}

# 5. CAI DAT GIT FOR WINDOWS
Write-Host "`n[5/9] Dang tai va cai dat Git for Windows..." -ForegroundColor Yellow
$gitInstaller = "$env:TEMP\Git-Installer.exe"
try {
    Invoke-WebRequest -Uri "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe" -OutFile $gitInstaller
    Start-Process -FilePath $gitInstaller -Args "/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS" -Wait
    Remove-Item $gitInstaller -Force -ErrorAction SilentlyContinue
    Write-Host " -> Da cai dat Git for Windows thanh cong." -ForegroundColor Green
} catch {
    Write-Host " -> Loi cai Git: $_" -ForegroundColor Red
}

# 6. CAI DAT CLOUDFLARE TUNNEL (CLOUDFLARED)
Write-Host "`n[6/9] Dang tai va cai dat Cloudflare Tunnel..." -ForegroundColor Yellow
try {
    $cloudflaredDir = "C:\Program Files\cloudflared"
    if (-not (Test-Path $cloudflaredDir)) {
        New-Item -ItemType Directory -Force -Path $cloudflaredDir | Out-Null
    }
    Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile "$cloudflaredDir\cloudflared.exe"
    
    $currentPath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    if ($currentPath -notlike "*cloudflared*") {
        [System.Environment]::SetEnvironmentVariable("Path", ($currentPath + ";" + $cloudflaredDir), "Machine")
    }
    Write-Host " -> Da cai dat cloudflared thanh cong." -ForegroundColor Green
} catch {
    Write-Host " -> Loi cai cloudflared: $_" -ForegroundColor Red
}

# CAP NHAT BIEN PATH CHO PHIEN LAM VIEC HIEN TAI
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User") + ";C:\Users\Administrator\.local\bin;C:\Program Files\Git\cmd;C:\Program Files\nodejs"

# 7. TU DONG CLONE HOAC CAP NHAT DU AN TU GITHUB
$projectDir = "C:\Project\mmo"
if (-not (Test-Path "$projectDir\.git")) {
    Write-Host "`n[7/9] Dang Clone du an tu GitHub ve $projectDir..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path "C:\Project" | Out-Null
    if ($GitToken) {
        git clone "https://$GitToken@github.com/Duke0503/shopee-aff.git" $projectDir
    } else {
        git clone "https://github.com/Duke0503/shopee-aff.git" $projectDir
    }
    Write-Host " -> Da Clone ma nguon tu GitHub thanh cong!" -ForegroundColor Green
} else {
    Write-Host "`n[7/9] Du an da ton tai tai $projectDir, dang cap nhat ma nguon..." -ForegroundColor Yellow
    Set-Location $projectDir
    git fetch origin main
    git reset --hard origin/main
    Write-Host " -> Da cap nhat ma nguon moi nhat!" -ForegroundColor Green
}

# 8. TU DONG DONG BO CAU HINH BAO MAT TU MAY CA NHAN SANG VPS QUA RDP
Write-Host "`n[8/9] Dang kiem tra va chuyen .env & credentials tu may ca nhan..." -ForegroundColor Yellow
$localPaths = @(
    "\\tsclient\c\Project\mmo",
    "\\tsclient\C\Project\mmo"
)
$syncedEnv = $false
foreach ($lp in $localPaths) {
    if (Test-Path "$lp\.env") {
        Copy-Item "$lp\.env" "$projectDir\.env" -Force
        Write-Host " -> [OK] Da tu dong sao chep file .env tu may ca nhan sang VPS!" -ForegroundColor Green
        $syncedEnv = $true
    }
    if (Test-Path "$lp\zalo_assistant\credentials.json") {
        if (-not (Test-Path "$projectDir\zalo_assistant")) {
            New-Item -ItemType Directory -Force -Path "$projectDir\zalo_assistant" | Out-Null
        }
        Copy-Item "$lp\zalo_assistant\credentials.json" "$projectDir\zalo_assistant\credentials.json" -Force
        Write-Host " -> [OK] Da tu dong sao chep credentials.json sang VPS!" -ForegroundColor Green
    }
}
if (-not $syncedEnv -and -not (Test-Path "$projectDir\.env")) {
    Write-Host " -> Chu y: Chua tim thay o chia se RDP. Ban co the dan .env vao $projectDir" -ForegroundColor DarkYellow
}

# 9. TU DONG CAU HINH GITHUB ACTIONS RUNNER (CI/CD 24/7)
Write-Host "`n[9/9] Kich hoat GitHub Actions Runner (CI/CD 24/7)..." -ForegroundColor Yellow
$runnerScript = "$projectDir\scripts\setup_ci_runner.ps1"
if (Test-Path $runnerScript) {
    & powershell -ExecutionPolicy Bypass -File $runnerScript -GitToken $GitToken
} else {
    Write-Host " -> Khong tim thay script setup_ci_runner.ps1" -ForegroundColor DarkYellow
}

# Tao shortcut ngoai Desktop
try {
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = "$desktopPath\KHOI_DONG_HE_THONG.bat"
    Set-Content -Path $shortcutPath -Value "@echo off`ncall `"$projectDir\start_vps.bat`""
    Write-Host " -> Da tao shortcut KHOI_DONG_HE_THONG ngoai Desktop VPS!" -ForegroundColor Green
} catch {}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "[HOAN TAT 100%] DA CAI DAT MOI TRUONG, DU LIEU VA CI/CD!" -ForegroundColor Green
Write-Host "Cac buoc tiep theo:" -ForegroundColor Yellow
Write-Host "1. Mo Chrome tren VPS -> chrome://extensions -> Load unpacked: C:\Project\mmo\extension" -ForegroundColor Yellow
Write-Host "2. Dang nhap tai khoan affiliate.shopee.vn" -ForegroundColor Yellow
Write-Host "3. Chay file KHOI_DONG_HE_THONG ngoai man hinh Desktop VPS!" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Green
