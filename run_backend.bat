@echo off
chcp 65001 >nul
cd /d "%~dp0"
:: Terminate any lingering/orphaned python instances to avoid port conflict
taskkill /F /FI "IMAGENAME eq python.exe" >nul 2>&1
timeout /t 1 >nul
uv run cashback serve
