@echo off
chcp 65001 >nul
setlocal EnableExtensions
title AGENTE LEADS - Detener Sistema

echo.
echo ============================================================
echo   🛑 Deteniendo AGENTE LEADS (Bot + Dashboard)
echo ============================================================
echo.

rem Cerrar ventana del Bot
taskkill /FI "WINDOWTITLE eq AGENTE LEADS - Bot*" /T /F >nul 2>nul
if not errorlevel 1 (
    echo  [OK] Bot de Telegram detenido.
) else (
    echo  [INFO] El Bot ya estaba cerrado.
)

rem Cerrar ventana del Dashboard
taskkill /FI "WINDOWTITLE eq AGENTE LEADS - Dashboard*" /T /F >nul 2>nul
if not errorlevel 1 (
    echo  [OK] Dashboard Web detenido.
) else (
    echo  [INFO] El Dashboard ya estaba cerrado.
)

echo.
echo  ============================================================
echo   ✅ Todos los servicios han sido detenidos.
echo  ============================================================
echo.
timeout /t 3 >nul
