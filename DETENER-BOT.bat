@echo off
chcp 65001 >nul
setlocal EnableExtensions
title DETENER - AGENTE LEADS

rem ============================================================
rem DETENER-BOT.bat - Apaga el bot de AGENTE LEADS con doble clic
rem Busca la ventana del bot y la cierra junto con su proceso.
rem No toca otras ventanas ni otros programas Node que tengas.
rem ============================================================

echo.
echo  Buscando la ventana del bot "AGENTE LEADS - Bot de Telegram"...
echo.

taskkill /FI "WINDOWTITLE eq AGENTE LEADS - Bot*" /T /F >nul 2>nul

if errorlevel 1 (
    echo  [INFO] No encontre ninguna ventana del bot abierta.
    echo         Si el bot sigue respondiendo en Telegram, espera unos
    echo         segundos y vuelve a ejecutar este archivo. Si la ventana
    echo         del bot esta visible, tambien puedes cerrarla a mano.
) else (
    echo  [OK] Bot detenido. La ventana del bot se ha cerrado.
)

echo.
echo  Esta ventana se cerrara sola en unos segundos...
timeout /t 6 >nul
exit /b 0
