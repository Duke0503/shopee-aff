@echo off
chcp 65001 >nul
cd /d "%~dp0zalo_assistant"
:: Terminate any lingering/orphaned node instances to avoid dual bot WebSocket conflict
taskkill /F /FI "IMAGENAME eq node.exe" >nul 2>&1
timeout /t 1 >nul
node assistant_worker.js
