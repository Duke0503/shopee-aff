@echo off
title KHOI DONG HE THONG HOAN TIEN SHOPEE / TIKTOK / LAZADA / SHOPEEFOOD
cd /d "%~dp0"
echo ========================================================
echo   DANG KHOI DONG HE THONG HOAN TIEN (BACKEND, BOT, WEB)...
echo ========================================================
powershell.exe -ExecutionPolicy Bypass -File "%~dp0scripts\start-all.ps1"
