@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   AGENTE LEADS - Arrancando Sistema Completo
echo ============================================================
echo.

echo [1/3] Arrancando WhatsApp Daemon (Baileys)...
start "AGENTE LEADS - WhatsApp Daemon" cmd /k "cd ..\AGENTE GENERAL\dashboard && node src\server\whatsapp-daemon.js"

echo [2/3] Arrancando Bot de Telegram...
start "AGENTE LEADS - Bot" cmd /k "npx tsx src\index.ts"

echo [3/3] Arrancando Dashboard Web...
start "AGENTE LEADS - Dashboard" cmd /k "cd dashboard && npx next dev -p 3000"

echo Esperando que los servidores esten listos...
timeout /t 6 /nobreak >nul

echo Abriendo navegador en http://localhost:3000...
start http://localhost:3000