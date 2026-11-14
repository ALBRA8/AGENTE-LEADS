@echo off
title AGENTE LEADS - Detener Sistema

echo ============================================================
echo  Apagando AGENTE LEADS (Bot, Dashboard y conexiones)...
echo ============================================================

taskkill /FI "WINDOWTITLE eq AGENTE LEADS - Bot*" /T /F
taskkill /FI "WINDOWTITLE eq AGENTE LEADS - Dashboard*" /T /F
taskkill /IM node.exe /F

echo.
echo ============================================================
echo  [OK] Todos los servicios han sido cerrados.
echo ============================================================
echo.
pause
