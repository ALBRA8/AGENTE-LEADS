@echo off
title AGENTE LEADS - Detener Sistema

echo ============================================================
echo  Apagando AGENTE LEADS (Bot, Dashboard y conexiones)...
echo ============================================================

taskkill /FI "WINDOWTITLE eq AGENTE LEADS - Bot*" /T /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq AGENTE LEADS - Dashboard*" /T /F >nul 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*src\index.ts*' -or $_.CommandLine -like '*next*' } | Stop-Process -Force -ErrorAction SilentlyContinue; Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo.
echo [OK] El Bot, el Dashboard y el puerto 3000 se han apagado completamente.
echo ============================================================
pause
