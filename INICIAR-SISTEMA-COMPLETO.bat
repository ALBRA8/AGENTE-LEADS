@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   AGENTE LEADS - Arrancando Sistema Completo
echo ============================================================
echo.

echo [1/2] Arrancando Bot de Telegram...
start "AGENTE LEADS - Bot" cmd /k "npx tsx src\index.ts"

echo [2/2] Arrancando Dashboard Web...
start "AGENTE LEADS - Dashboard" cmd /k "cd dashboard && npx next dev -p 3000"

echo Esperando que el servidor web este listo...
timeout /t 6 /nobreak >nul

echo Abriendo navegador en http://localhost:3000...
start http://localhost:3000