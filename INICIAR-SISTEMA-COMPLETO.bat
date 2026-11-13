@echo off
chcp 65001 >nul
setlocal EnableExtensions
title AGENTE LEADS - Sistema Completo

rem ============================================================
rem INICIAR-SISTEMA-COMPLETO.bat - AGENTE LEADS
rem Arranca el Bot de Telegram + el Dashboard Web (Next.js)
rem y abre la interfaz gráfica en tu navegador automáticamente.
rem ============================================================

cd /d "%~dp0"

echo.
echo ============================================================
echo   🚀 AGENTE LEADS - Iniciando Sistema Completo
echo ============================================================
echo.

rem 1. Comprobar Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js no está instalado o no está en el PATH.
    pause
    exit /b 1
)

rem 2. Arrancar el Bot de Telegram en ventana separada
echo [1/3] 🤖 Arrancando Bot de Telegram...
start "AGENTE LEADS - Bot" cmd /c "npx tsx src\index.ts"

rem 3. Arrancar el Dashboard Web (Next.js) en ventana separada
echo [2/3] 🌐 Arrancando Dashboard Web (Puerto 3000)...
start "AGENTE LEADS - Dashboard" cmd /c "cd dashboard && npm run dev"

rem 4. Esperar unos segundos a que levante el servidor web
echo [3/3] ⏳ Esperando inicio del servidor web...
timeout /t 5 /nobreak >nul

rem 5. Abrir el navegador en el Dashboard
echo ✅ Abriendo Dashboard en http://localhost:3000...
start http://localhost:3000

echo.
echo ============================================================
echo   ✅ SISTEMA ACTIVO Y EN ESCUCHA
echo   - Bot Telegram: Corriendo en su ventana dedicada
echo   - Dashboard: http://localhost:3000
echo   - Para detener todo: usa DETENER-TODO.bat
echo ============================================================
echo.
