# 🚀 04 — Guía de Despliegue y Operación

## 1. Requisitos Previos

- **Node.js**: Versión 20+ (Recomendado v20.x, v22.x o v24.x con `better-sqlite3` actualizado).
- **Git** instalado.
- Cuenta de Telegram con Bot creado en [@BotFather](https://t.me/BotFather).
- API Key de **NVIDIA NIM** (obtenida en [build.nvidia.com](https://build.nvidia.com)).

---

## 2. Variables de Entorno Obligatorias (`.env`)

Asegúrate de configurar los siguientes parámetros en tu archivo `.env`:

```env
# ============================================================
# AGENTE LEADS – Variables Principales
# ============================================================

# Token de bot de Telegram (de @BotFather)
TELEGRAM_BOT_TOKEN=123456789:ABCDefGhIJKlmNoPQRsTUVwxyZ

# IDs numéricos de Telegram autorizados (separados por coma)
ALLOWED_IDS=1204900940

# Clave de NVIDIA NIM para el modelo LLM
NVIDIA_API_KEY=nvapi-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Rutas de base de datos
DB_PATH=./data/agente-leads.db
LEAD_DB_PATH=./data/lead-intelligence.db

# Configuración del agente
AGENT_NAME=AGENTE LEADS
MAX_TOOL_ITERATIONS=15
LOG_LEVEL=info

# ============================================================
# Servicios Externos (Opcionales para pipelines avanzados)
# ============================================================
APIFY_TOKEN=apify_api_xxxxxxxxxxxxxxxx
AIRTABLE_TOKEN=pat_xxxxxxxxxxxxxxxx
AIRTABLE_BASE_ID=appxxxxxxxxxxxx
```

---

## 3. Formas de Iniciar el Agente

### Opción A: Lanzador de Doble Clic en Windows (Recomendado)
- Haz doble clic en el archivo `INICIAR-BOT.bat`.
- El script validará el entorno y levantará el bot en una ventana dedicada.
- Para cerrarlo de forma limpia, ejecuta `DETENER-BOT.bat`.

### Opción B: Modo Desarrollo con Recarga Automática
```bash
npm run dev
```

### Opción C: Modo Producción Compilado
```bash
npm run build
npm start
```

---

## 4. Comandos de Mantenimiento y Verificación

```bash
# Comprobar tipos TypeScript
npm run typecheck

# Compilar proyecto a dist/
npm run build

# Ejecutar suite de tests
npm test
```

---

## 5. Solución de Problemas Frecuentes (Troubleshooting)

### Error `Could not locate the bindings file / better_sqlite3.node`
Ocurre si se actualiza la versión de Node.js en la máquina. Se resuelve ejecutando:
```bash
npm install better-sqlite3@latest
npm run build
```

### Error `Unauthorized user` en Telegram
El ID de Telegram del usuario que envía el mensaje no está en la lista `ALLOWED_IDS` de `.env`. Agrega el ID numérico correspondiente y reinicia el bot.
