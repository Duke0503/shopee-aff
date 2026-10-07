@echo off
REM Start the migration path router (Caddy) with the strangler config (ADR-15).
REM Caddy is a single Windows program; point CADDY_EXE at it if it is not on PATH.
setlocal
if "%CADDY_EXE%"=="" set "CADDY_EXE=caddy"
"%CADDY_EXE%" run --config "%~dp0..\ops\caddy\Caddyfile"
endlocal
