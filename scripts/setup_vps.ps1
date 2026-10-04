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
    Write-Host "`n[7/9] Đang Clone dự án từ GitHub về $projectDir..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path "C:\Project" | Out-Null
    if ($GitToken) {
        git clone "https://$GitToken@github.com/Duke0503/shopee-aff.git" $projectDir
    } else {
        git clone "https://github.com/Duke0503/shopee-aff.git" $projectDir
    }
    Write-Host " -> Đã Clone mã nguồn từ GitHub thành công!" -ForegroundColor Green
} else {
    Write-Host "`n[7/9] Dự án đã tồn tại tại $projectDir, đang cập nhật mã nguồn..." -ForegroundColor Yellow
    Set-Location $projectDir
    git fetch origin main
    git reset --hard origin/main
    Write-Host " -> Đã cập nhật mã nguồn mới nhất!" -ForegroundColor Green
}

# 8. TỰ ĐỘNG ĐỒNG BỘ CẤU HÌNH BẢO MẬT TỪ MÁY CÁ NHÂN SANG VPS QUA RDP
Write-Host "`n[8/9] Đang tự động kiểm tra và chuyển .env & credentials từ máy cá nhân..." -ForegroundColor Yellow
$localPaths = @(
    "\\tsclient\c\Project\mmo",
    "\\tsclient\C\Project\mmo"
)
$syncedEnv = $false
foreach ($lp in $localPaths) {
    if (Test-Path "$lp\.env") {
        Copy-Item "$lp\.env" "$projectDir\.env" -Force
        Write-Host " -> [OK] Đã tự động sao chép file .env từ máy cá nhân sang VPS!" -ForegroundColor Green
        $syncedEnv = $true
    }
    if (Test-Path "$lp\zalo_assistant\credentials.json") {
        if (-not (Test-Path "$projectDir\zalo_assistant")) {
            New-Item -ItemType Directory -Force -Path "$projectDir\zalo_assistant" | Out-Null
        }
        Copy-Item "$lp\zalo_assistant\credentials.json" "$projectDir\zalo_assistant\credentials.json" -Force
        Write-Host " -> [OK] Đã tự động sao chép credentials.json từ máy cá nhân sang VPS!" -ForegroundColor Green
    }
}
if (-not $syncedEnv -and -not (Test-Path "$projectDir\.env")) {
    Write-Host " -> Ghi chú: Chưa tìm thấy ổ chia sẻ RDP. Nếu cần bạn có thể dán .env vào $projectDir" -ForegroundColor DarkYellow
}

# 9. TỰ ĐỘNG CẤU HÌNH GITHUB ACTIONS RUNNER (CI/CD 24/7)
Write-Host "`n[9/9] Kích hoạt GitHub Actions Runner (CI/CD Tự Động)..." -ForegroundColor Yellow
$runnerScript = "$projectDir\scripts\setup_ci_runner.ps1"
if (Test-Path $runnerScript) {
    & powershell -ExecutionPolicy Bypass -File $runnerScript -GitToken $GitToken
} else {
    Write-Host " -> Bỏ qua cấu hình runner do không tìm thấy file script." -ForegroundColor DarkYellow
}

# Tạo shortcut trên Desktop của VPS
try {
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = "$desktopPath\KHOI_DONG_HE_THONG.bat"
    Set-Content -Path $shortcutPath -Value "@echo off`ncall `"$projectDir\start_vps.bat`""
    Write-Host " -> Đã tạo shortcut khởi động hệ thống ngoài Desktop VPS!" -ForegroundColor Green
} catch {}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "🎉 HOÀN TẤT 100% CÀI ĐẶT MÔI TRƯỜNG, DỮ LIỆU & CI/CD!" -ForegroundColor Green
Write-Host "Bây giờ bạn chỉ cần:" -ForegroundColor Yellow
Write-Host "1. Mở Chrome trên VPS -> chrome://extensions -> Load unpacked: C:\Project\mmo\extension" -ForegroundColor Yellow
Write-Host "2. Đăng nhập affiliate.shopee.vn" -ForegroundColor Yellow
Write-Host "3. Chạy file KHOI_DONG_HE_THONG ngoài màn hình Desktop VPS!" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Green
