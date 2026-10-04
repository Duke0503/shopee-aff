@echo off
chcp 65001 >nul
title [HOAN TIEN DP] - KHOI DONG HE THONG PRODUCTION TRON GOI

echo ==========================================================
echo 🚀 ĐANG KHỞI ĐỘNG HỆ THỐNG HOÀN TIỀN DP TRÊN VPS PRODUCTION
echo ==========================================================
echo.

cd /d "%~dp0"

:: 1. Khởi động Backend Python Server (Dashboard + API + Worker Bridge)
echo [1/3] Khởi động Backend Server (Port 8899)...
start "Cashback Backend" cmd /k "chcp 65001 >nul && uv run cashback serve"
timeout /t 3 >nul

:: 2. Khởi động Zalo Assistant Bot Worker
echo [2/3] Khởi động Zalo Assistant Bot Worker...
start "Zalo Assistant Bot" cmd /k "chcp 65001 >nul && cd zalo_assistant && node assistant_worker.js"
timeout /t 3 >nul

:: 3. Khởi động Cloudflare Tunnel (hoantiendp.com)
echo [3/3] Khởi động Cloudflare Tunnel...
start "Cloudflare Tunnel" cmd /k "powershell -ExecutionPolicy Bypass -File scripts\start-tunnel.ps1"

echo.
echo ==========================================================
echo ✅ TẤT CẢ TIẾN TRÌNH ĐÃ ĐƯỢC BẬT TRÊN CÁC CỬA SỔ RIÊNG BIỆT!
echo 👉 Vui lòng mở Google Chrome, vào chrome://extensions load extension và đăng nhập Shopee Affiliate.
echo ==========================================================
echo.
pause
