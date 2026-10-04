# =====================================================================
# SCRIPT TỰ ĐỘNG CÀI ĐẶT GITHUB ACTIONS RUNNER (CI/CD) CHO VPS
# Chạy dưới dạng Windows Service - Tự khởi động cùng hệ thống 24/7
# =====================================================================

param(
    [string]$GitToken = $env:GITHUB_TOKEN,
    [string]$Repo = "Duke0503/shopee-aff"
)

if (-not $GitToken) {
    $GitToken = Read-Host "Nhập GitHub Personal Access Token (ghp_...)"
}

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "🚀 ĐANG CẤU HÌNH GITHUB ACTIONS RUNNER (CI/CD) TRÊN VPS..." -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Gọi GitHub API lấy Registration Token cho Runner
Write-Host "`n[1/3] Đang kết nối GitHub API lấy mã đăng ký Runner..." -ForegroundColor Yellow
$headers = @{
    "Authorization" = "token $GitToken"
    "Accept" = "application/vnd.github.v3+json"
    "User-Agent" = "DeployBot/1.0"
}

try {
    $res = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/actions/runners/registration-token" -Method Post -Headers $headers
    $regToken = $res.token
} catch {
    Write-Host "Lỗi: Không thể lấy token đăng ký từ GitHub API: $_" -ForegroundColor Red
    exit 1
}

if (-not $regToken) {
    Write-Host "Lỗi: Không lấy được token đăng ký Runner từ GitHub!" -ForegroundColor Red
    exit 1
}

Write-Host " -> Lấy registration token thành công: $regToken" -ForegroundColor Green

# 2. Tạo thư mục C:\actions-runner
$runnerDir = "C:\actions-runner"
if (-not (Test-Path $runnerDir)) {
    New-Item -ItemType Directory -Force -Path $runnerDir | Out-Null
}
Set-Location $runnerDir

# 3. Tải Runner Package nếu chưa có
Write-Host "`n[2/3] Đang tải GitHub Actions Runner binary..." -ForegroundColor Yellow
$runnerZip = "$runnerDir\actions-runner.zip"
if (-not (Test-Path "$runnerDir\config.cmd")) {
    Invoke-WebRequest -Uri "https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-win-x64-2.321.0.zip" -OutFile $runnerZip
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($runnerZip, $runnerDir)
    Remove-Item $runnerZip -Force -ErrorAction SilentlyContinue
}

# 4. Cấu hình Runner và cài đặt dưới dạng Windows Service
Write-Host "`n[3/3] Đang đăng ký Runner với GitHub repo và cài đặt Windows Service..." -ForegroundColor Yellow
& .\config.cmd --url "https://github.com/$Repo" --token $regToken --name "hoantiendp-vps" --work "_work" --runasservice --unattended --replace

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "🎉 GITHUB ACTIONS CI/CD RUNNER ĐÃ ĐƯỢC KÍCH HOẠT THÀNH CÔNG!" -ForegroundColor Green
Write-Host "Từ bây giờ, mỗi lần commit lên nhánh 'main', VPS sẽ tự động cập nhật!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
