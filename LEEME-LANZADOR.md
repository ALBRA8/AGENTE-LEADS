# Lanzador de doble clic — AGENTE LEADS

Con estos archivos el bot se arranca como cualquier programa de Windows:
**doble clic y listo**, sin PowerShell, sin terminales y sin comandos.

---

## Qué es cada archivo

| Archivo | Para qué sirve |
|---|---|
| `INICIAR-BOT.bat` | Arranca el bot de Telegram. Abre una ventana con los mensajes en vivo y, si el bot se cae, **reinicia solo** hasta 5 veces. |
| `DETENER-BOT.bat` | Apaga el bot con doble clic, sin buscar ventanas ni procesos a mano. |
| `LEEME-LANZADOR.md` | Esta guía. |

---

## Primer arranque (una sola vez)

1. Copia estos archivos en la **carpeta raíz del proyecto** (la misma donde están `package.json` y la carpeta `src`). Si ya los descargaste ahí, no hagas nada.
2. Asegúrate de tener el archivo `.env` en esa carpeta con tus claves rellenas. Si no lo tienes, copia `.env.example`, renómbralo a `.env` y rellena como mínimo:
   - `TELEGRAM_BOT_TOKEN` → el token que te dio @BotFather
   - `NVIDIA_API_KEY` → tu clave de NVIDIA NIM
   - `ALLOWED_IDS` → tu ID de Telegram
3. Doble clic en `INICIAR-BOT.bat`. La primera vez instala las dependencias automáticamente (5–10 minutos); a partir de la segunda vez el bot arranca en segundos.

## Uso diario

- **Arrancar:** doble clic en `INICIAR-BOT.bat`. Cuando veas `✅ Bot started: @tu_bot`, ya está vivo y escuchando Telegram.
- **Parar:** cierra la ventana del bot, o doble clic en `DETENER-BOT.bat`.
- **Si se cae solo:** el lanzador lo reinicia cada 10 segundos (hasta 5 intentos). Si tras 5 intentos sigue cayéndose, la ventana se queda abierta mostrando el último error: cópialo y envíaselo a tu asistente para diagnosticarlo.

> Importante: la ventana del bot **es** el bot. Si la cierras, el bot se apaga (es un apagado normal, no rompe nada).

## Ponerlo en el escritorio (opcional, 3 clics)

1. Clic derecho sobre `INICIAR-BOT.bat` → **Enviar a** → **Escritorio (crear acceso directo)**.
2. (Opcional) Clic derecho en el acceso directo del escritorio → **Propiedades** → **Cambiar icono** para ponerle un icono que te guste.
3. Desde el escritorio también puedes crear el acceso directo de `DETENER-BOT.bat` del mismo modo.

El acceso directo funciona siempre porque el lanzador trabaja sobre la carpeta donde vive el proyecto, no sobre la carpeta desde la que lo pulses.

## Requisitos

- **Windows 10 u 11** (funciona también en Windows 8).
- **Node.js 20 o superior** instalado. El lanzador lo comprueba: si falta o es antiguo, te lo dice y te apunta a https://nodejs.org (descarga la versión LTS).
- El archivo `.env` con tus claves (ver primer arranque).

## Problemas frecuentes

| Mensaje | Qué hacer |
|---|---|
| `Node.js no esta instalado o no esta en el PATH` | Instala Node.js LTS desde https://nodejs.org y vuelve a hacer doble clic. |
| `Falta el archivo .env` | Copia `.env.example` como `.env` en la carpeta del proyecto y rellena tus claves. |
| `Fallo la instalacion de dependencias` | Revisa tu conexión a internet y vuelve a abrir `INICIAR-BOT.bat`; el instalación se reintenta entera. |
| El bot arranca pero se reinicia 5 veces y para | Deja la ventana abierta, copia el último error en rojo y pásaselo a tu asistente. Suele ser una clave mal puesta en `.env` o sin internet. |
| `DETENER-BOT` dice que no encontró la ventana | El bot probablemente ya estaba apagado. Si sigue vivo en Telegram, cierra la ventana del bot a mano. |

## Cómo funciona por dentro (resumen técnico)

`INICIAR-BOT.bat` ejecuta, en orden: comprueba que Node.js existe (`where node`) → comprueba que `.env` existe → si no existe `node_modules`, ejecuta `npm install` una única vez → arranca el bot con `npx tsx src\index.ts` (TypeScript directo, sin compilar) → si el proceso termina con error y no fue un Ctrl+C, espera 10 segundos y reintenta (máximo 5 intentos).

`DETENER-BOT.bat` usa `taskkill /FI "WINDOWTITLE eq AGENTE LEADS - Bot*" /T /F`: solo cierra la ventana cuyo título coincida con la ventana del bot (y su árbol de procesos), así que **no toca** otras ventanas ni otros programas Node.js que tengas abiertos.
