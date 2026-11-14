@echo off
chcp 65001 >nul
setlocal EnableExtensions
title AGENTE LEADS - Bot de Telegram

rem ============================================================
rem INICIAR-BOT.bat - Lanzador de doble clic para AGENTE LEADS
rem Arranca el bot sin abrir PowerShell ni terminales a mano.
rem   - Ventana visible con los logs del bot en vivo
rem   - Si el bot se cae, reinicia solo (hasta 5 intentos)
rem   - Para parar: cierra esta ventana o usa DETENER-BOT.bat
rem ============================================================

cd /d "%~dp0"

echo.
echo  ============================================================
echo    AGENTE LEADS - Arrancando bot de Telegram
echo  ============================================================
echo.

rem ---- 1) Comprobar Node.js ------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo  [ERROR] Node.js no esta instalado o no esta en el PATH.
    echo          Descargalo desde https://nodejs.org - version LTS.
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node --version') do set "NODE_VER=%%v"
echo  [OK] Node.js %NODE_VER% detectado.

set "NODE_MAJOR="
if defined NODE_VER for /f "tokens=1 delims=v." %%a in ("%NODE_VER%") do set "NODE_MAJOR=%%a"
if defined NODE_MAJOR if %NODE_MAJOR% LSS 20 (
    echo  [AVISO] Tu Node es %NODE_VER% y lo recomendado es 20 o superior.
    echo          Si el bot falla, actualiza Node desde https://nodejs.org
)

rem ---- 2) Comprobar configuracion .env -------------------------
if not exist ".env" (
    echo  [ERROR] Falta el archivo .env en esta carpeta:
    echo          %cd%
    echo.
    echo          Solucion: copia .env.example como .env y rellena al menos:
    echo            TELEGRAM_BOT_TOKEN=tu token de @BotFather
    echo            NVIDIA_API_KEY=tu clave de NVIDIA NIM
    echo            ALLOWED_IDS=tu ID de Telegram
    echo.
    pause
    exit /b 1
)
echo  [OK] Configuracion .env encontrada.

rem ---- 3) Instalar dependencias solo la primera vez ------------
if not exist "node_modules\" (
    echo  [..] Primera vez aqui: instalando dependencias, 5-10 minutos...
    echo       Deja esta ventana abierta hasta que termine.
    call npm install
    if errorlevel 1 (
        echo  [ERROR] Fallo la instalacion de dependencias - npm install.
        echo          Revisa tu conexion a internet y vuelve a abrir este archivo.
        pause
        exit /b 1
    )
)
echo  [OK] Dependencias listas.

rem ---- 4) Arrancar el bot con reinicio automatico ---------------
set /a INTENTOS=1

:arrancar
echo.
echo  [BOT] Intento %INTENTOS% de 5 - arrancando AGENTE LEADS...
echo  ------------------------------------------------------------
call npx tsx src\index.ts
set "SALIDA=%errorlevel%"

rem  Salida limpia 0 = el bot se detuvo por si solo: no reiniciar
if "%SALIDA%" EQU "0" goto detenido
rem  0xC000013A = cortaste con Ctrl+C o cerraste la consola: no reiniciar
if "%SALIDA%" EQU "-1073741510" goto detenido

if %INTENTOS% GEQ 5 (
    echo.
    echo  [ERROR] El bot se ha caido %INTENTOS% veces seguidas. Me detengo.
    echo          Copia el ultimo error de arriba y enviaselo a tu asistente.
    echo.
    pause
    exit /b 1
)

set /a INTENTOS+=1
echo.
echo  [AVISO] El bot se cerro inesperadamente. Reiniciando en 10 segundos...
echo          Para parar del todo, cierra esta ventana ahora mismo.
timeout /t 10 /nobreak >nul
goto arrancar

:detenido
echo.
echo  [OK] Bot detenido. Puedes cerrar esta ventana.
timeout /t 8 >nul
exit /b 0
