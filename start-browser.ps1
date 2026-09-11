# Launch a browser that exists only to run the cashback extension.
#
# The operator's everyday browser carries dozens of tabs and several GB;
# having the bot depend on it means the machine cannot be tidied without
# taking link generation down with it. This is a separate binary with its
# own profile directory, so the two are unrelated: close the daily browser
# whenever you like.
#
# The profile is persistent, so the Shopee login survives restarts. Log in
# once, on the first run.

$ErrorActionPreference = "Stop"

$Root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$Extension = Join-Path $Root "extension"
$Profile   = Join-Path $Root ".browser-profile"

$Browser = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $Browser) { throw "No Chrome or Edge found." }
if (-not (Test-Path (Join-Path $Extension "manifest.json"))) {
  throw "Extension not found at $Extension"
}
if (-not (Test-Path (Join-Path $Extension "background\base_url.js"))) {
  throw "base_url.js is missing. Run: uv run cashback setup-token"
}

$IsNew = -not (Test-Path $Profile)
if ($IsNew) { New-Item -ItemType Directory -Path $Profile -Force | Out-Null }

$Args = @(
  "--user-data-dir=$Profile"
  "--load-extension=$Extension"
  "--disable-extensions-except=$Extension"
  "--no-first-run"
  "--no-default-browser-check"
  "--disable-sync"
  "--disable-background-networking"
  "--disable-component-update"
  "--disable-features=Translate,OptimizationHints,MediaRouter"
  # Two tabs share one renderer instead of taking one each.
  "--renderer-process-limit=2"
  "https://affiliate.shopee.vn/offer/custom_link"
  "https://shopee.vn/"
)

Write-Host "Browser : $Browser"
Write-Host "Profile : $Profile"
Write-Host "Loading : $Extension"
Start-Process -FilePath $Browser -ArgumentList $Args | Out-Null

if ($IsNew) {
  Write-Host ""
  Write-Host "FIRST RUN -- this profile has never logged in." -ForegroundColor Yellow
  Write-Host "Sign in to Shopee in the window that just opened, then keep it open."
  Write-Host "The login is remembered from now on."
} else {
  Write-Host ""
  Write-Host "Running. The extension reconnects to the bridge within ~30s."
}
Write-Host "Leave this window open; the daily browser can be closed freely."
