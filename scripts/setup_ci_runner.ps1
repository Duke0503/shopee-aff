# =====================================================================
# SCRIPT TU DONG CAI DAT GITHUB ACTIONS RUNNER (CI/CD) CHO VPS
# Chay duoi dang Windows Service - Tu khoi dong cung he thong 24/7
# =====================================================================

param(
    [string]$GitToken = $env:GITHUB_TOKEN,
    [string]$Repo = "Duke0503/shopee-aff"
)

if (-not $GitToken) {
    $GitToken = Read-Host "Nhap GitHub Personal Access Token (ghp_...)"
}

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "[HOAN TIEN DP] DANG CAU HINH GITHUB ACTIONS RUNNER (CI/CD)..." -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Goi GitHub API lay Registration Token cho Runner
Write-Host "`n[1/3] Dang ket noi GitHub API lay ma dang ky Runner..." -ForegroundColor Yellow
$headers = @{
    "Authorization" = "token $GitToken"
    "Accept" = "application/vnd.github.v3+json"
    "User-Agent" = "DeployBot/1.0"
}

try {
    $res = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/actions/runners/registration-token" -Method Post -Headers $headers
    $regToken = $res.token
} catch {
    Write-Host "Loi: Khong the lay token dang ky tu GitHub API: $_" -ForegroundColor Red
    exit 1
}

if (-not $regToken) {
    Write-Host "Loi: Khong lay duoc token dang ky Runner tu GitHub!" -ForegroundColor Red
    exit 1
}

Write-Host " -> Lay registration token thanh cong: $regToken" -ForegroundColor Green

# 2. Tao thu muc C:\actions-runner
$runnerDir = "C:\actions-runner"
if (-not (Test-Path $runnerDir)) {
    New-Item -ItemType Directory -Force -Path $runnerDir | Out-Null
}
Set-Location $runnerDir

# 3. Tai Runner Package neu chua co
Write-Host "`n[2/3] Dang tai GitHub Actions Runner binary..." -ForegroundColor Yellow
$runnerZip = "$runnerDir\actions-runner.zip"
if (-not (Test-Path "$runnerDir\config.cmd")) {
    Invoke-WebRequest -Uri "https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-win-x64-2.321.0.zip" -OutFile $runnerZip
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($runnerZip, $runnerDir)
    Remove-Item $runnerZip -Force -ErrorAction SilentlyContinue
}

# 4. Cau hinh Runner va cai dat duoi dang Windows Service
Write-Host "`n[3/3] Dang dang ky Runner voi GitHub repo va cai dat Windows Service..." -ForegroundColor Yellow
& .\config.cmd --url "https://github.com/$Repo" --token $regToken --name "hoantiendp-vps" --work "_work" --runasservice --unattended --replace

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "[HOAN TAT] GITHUB ACTIONS CI/CD RUNNER DA DUOC KICH HOAT THANH CONG!" -ForegroundColor Green
Write-Host "Moi lan commit len nhanh 'main', VPS se tu dong cap nhat!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
