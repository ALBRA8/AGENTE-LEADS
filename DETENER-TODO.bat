@echo off
setlocal
echo ============================================================
echo   Deteniendo AGENTE LEADS...
echo ============================================================

taskkill /FI "WINDOWTITLE eq AGENTE LEADS - Bot*" /T /F 2>nul
taskkill /FI "WINDOWTITLE eq AGENTE LEADS - Dashboard*" /T /F 2>nul
taskkill /FI "WINDOWTITLE eq AGENTE LEADS - WhatsApp*" /T /F 2>nul
taskkill /IM node.exe /F 2>nul

echo.
echo [OK] Servicios detenidos.
pause