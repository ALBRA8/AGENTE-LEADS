# DEPLOYMENT — AGENTE LEADS

> Guía de deployment en producción: prerequisitos, setup local, PM2 / systemd / Docker, configuración de Telegram / SendGrid / WhatsApp / CRM-ALBRA, health checks, backup, troubleshooting y performance tuning.

---

## 1. Prerequisitos

### 1.1. Sistema

| Componente | Versión mínima | Verificación |
|------------|----------------|--------------|
| Node.js | **20+** (recomendado 20 LTS o 22 LTS) | `node --version` |
| npm | 10+ | `npm --version` |
| Python | 3.10+ (solo para el scraper stealth) | `python3 --version` |
| SQLite | 3.30+ (mejor-sqlite3 lo embebe) | `sqlite3 --version` |
| RAM | 512 MB mínimo, 1 GB recomendado | — |
| Disk | 1 GB para app + DBs; crece ~10 MB/día por uso medio | — |
| OS | Linux (Ubuntu 22.04+ recomendado); macOS y Windows funcionan pero no son probados en prod | — |

### 1.2. Cuentas externas

| Servicio | Para qué | Cómo obtener |
|----------|----------|--------------|
| **NVIDIA NIM API key** | LLM GLM 5.3 Flash | [build.nvidia.com](https://build.nvidia.com/) → sign in → generate API key. Empieza por `nvapi-...` |
| **Telegram bot token** | Bot conversacional | [@BotFather](https://t.me/BotFather) → `/newbot` |
| **Telegram user IDs** | Whitelist de acceso | [@userinfobot](https://t.me/userinfobot) → te responde con tu ID |
| **Apify token** (opcional) | Discovery + Research real | [apify.com](https://apify.com/) → Settings → Integrations → API token |
| **SendGrid account** | Outreach email | [sendgrid.com](https://sendgrid.com/) → crear cuenta (free tier: 100 emails/día) |
| **Meta Business App** | WhatsApp Cloud API | [developers.facebook.com](https://developers.facebook.com/) → WhatsApp Cloud API setup |
| **CRM-ALBRA endpoint** (opcional) | Webhook receptor | Lo provee tu CRM. Si no tienes, se omite. |

---

## 2. Setup local para desarrollo

```bash
# 1. Clonar
git clone https://github.com/ALBRA8/AGENTE-LEADS.git
cd AGENTE-LEADS

# 2. Instalar deps Node
npm install

# 3. (Opcional) Python venv para scraper stealth
python3 -m venv .venv
source .venv/bin/activate
pip install -r src/agent/scripts/requirements.txt
deactivate

# 4. Configurar .env
cp .env.example .env
# Edita .env — al menos:
#   NVIDIA_API_KEY=nvapi-xxxxxxxx
#   TELEGRAM_BOT_TOKEN=123456:ABC-xxxx
#   ALLOWED_IDS=123456789
#   (opcional: APIFY_TOKEN para discovery real)

# 5. Verificar type-check (debe pasar sin errores)
npm run typecheck

# 6. Modo dev (hot reload)
npm run dev

# 7. En otra terminal: correr tests
npm test
```

Si todo funciona, verás en la consola de `npm run dev`:

```
╔═══════════════════════════════════════╗
║           AGENTE LEADS                ║
║   Kimi K2.5 · NVIDIA NIM · grammy     ║
╚═══════════════════════════════════════╝
[Boot] 🗄️  Database initialized (SQLite WAL mode)
[Boot] 🤖 Starting Telegram bot (Long Polling)…
[Boot] ✅ Bot started: @tu_bot (ID: 1234567890)
[Boot] 🔑 Whitelist active – only allowed users can chat.
[Boot] 🚀 AGENTE LEADS is live and listening!
```

Ahora envía `/start` desde Telegram y deberías recibir la bienvenida.

---

## 3. Deployment en producción

### 3.1. PM2 (recomendado para Linux VPS)

```bash
# Instalar PM2 global
npm install -g pm2

# Build de producción
npm run build

# Arrancar con PM2
pm2 start dist/index.js --name agente-leads

# Guardar proceso y habilitar boot
pm2 save
pm2 startup   # sigue las instrucciones que te muestre

# Ver logs
pm2 logs agente-leads

# Status
pm2 status

# Restart tras deploy
pm2 restart agente-leads

# Stop
pm2 stop agente-leads

# Eliminar
pm2 delete agente-leads
```

**Ecosystem file** (`ecosystem.config.cjs`) recomendado:

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'agente-leads',
    script: 'dist/index.js',
    instances: 1,           // IMPORTANTE: 1 sola instancia (SQLite + Telegram long polling)
    exec_mode: 'fork',
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
    },
    env_file: '.env',
    // Restart policy
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 5000,
    // Logs
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
  }]
};
```

Arrancar con: `pm2 start ecosystem.config.cjs`

### 3.2. systemd (alternativa nativa Linux)

Crea `/etc/systemd/system/agente-leads.service`:

```ini
[Unit]
Description=AGENTE LEADS — Autonomous Lead Intelligence
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=agente                          # crea este user: sudo useradd -m -s /bin/bash agente
WorkingDirectory=/opt/agente-leads
EnvironmentFile=/opt/agente-leads/.env
ExecStart=/usr/bin/node /opt/agente-leads/dist/index.js
Restart=on-failure
RestartSec=5s
StandardOutput=append:/var/log/agente-leads.log
StandardError=append:/var/log/agente-leads.err.log

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/agente-leads/data /var/log
CapabilityBoundingSet=
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
```

Comandos:

```bash
# Crear usuario y directorios
sudo useradd -m -s /bin/bash agente
sudo mkdir -p /opt/agente-leads /var/log
sudo chown -R agente:agente /opt/agente-leads

# Deploy (como usuario agente o con sudo)
sudo -u agente git clone https://github.com/ALBRA8/AGENTE-LEADS.git /opt/agente-leads
cd /opt/agente-leads
sudo -u agente npm ci --omit=dev
sudo -u agente npm run build

# Configurar .env (root para proteger secrets)
sudo nano /opt/agente-leads/.env
sudo chmod 600 /opt/agente-leads/.env
sudo chown agente:agente /opt/agente-leads/.env

# Arrancar
sudo systemctl daemon-reload
sudo systemctl enable agente-leads
sudo systemctl start agente-leads

# Status / logs
sudo systemctl status agente-leads
sudo journalctl -u agente-leads -f
```

### 3.3. Docker (para deployment contenerizado)

`Dockerfile`:

```dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# Python + scrapling (opcional — solo si usas scrape_stealth)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY src/agent/scripts/requirements.txt ./src/agent/scripts/
RUN python3 -m venv .venv && \
    .venv/bin/pip install --no-cache-dir -r src/agent/scripts/requirements.txt
COPY --from=builder /app/src/agent/scripts ./src/agent/scripts
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

`docker-compose.yml`:

```yaml
version: '3.9'
services:
  agente-leads:
    build: .
    container_name: agente-leads
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./data:/app/data        # SQLite DBs persistentes
      - ./logs:/app/logs        # logs
    # Long polling — no abrimos puertos inbound
    # Si tu CRM webhook necesita recibir del bot, mapea el puerto HTTP aquí
    mem_limit: 1g
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
```

Comandos:

```bash
# Build + up
docker compose up -d --build

# Logs
docker compose logs -f agente-leads

# Restart
docker compose restart agente-leads

# Stop + remove
docker compose down

# Backup DBs (con el bot corriendo — WAL lo permite)
docker compose exec agente-leads sqlite3 /app/data/lead-intelligence.db ".backup /data/backup-$(date +%Y%m%d).db"
```

---

## 4. Configuración paso a paso de cada servicio externo

### 4.1. Telegram bot setup

1. Abre [@BotFather](https://t.me/BotFather) en Telegram.
2. Envía `/newbot`.
3. BotFather pregunta por:
   - **Nombre**: `AGENTE LEADS` (o el que prefieras).
   - **Username**: debe terminar en `bot`, ej. `agente_leads_bot`.
4. BotFather responde con un HTTP API token como: `1234567890:AAH...long-string`.
5. Copia ese token → `.env` → `TELEGRAM_BOT_TOKEN=...`.
6. Para tu propio user ID (whitelist):
   - Abre [@userinfobot](https://t.me/userinfobot) en Telegram.
   - Te responde con `Id: 123456789` — ese es tu user ID.
   - Si vas a dar acceso a colegas, pídeles su ID y agrégalos separados por coma: `ALLOWED_IDS=123456789,987654321`.
7. Reinicia el bot y verifica con `/start` desde tu Telegram.

> **Seguridad**: Nunca commitees el `.env`. El `.gitignore` debe incluir `.env`. El token filtrado debe regenerarse en BotFather (`/revoke` + `/token`).

### 4.2. NVIDIA NIM API key

1. Ve a [build.nvidia.com](https://build.nvidia.com/).
2. Sign in con cuenta NVIDIA (gratis).
3. Navega a "GLM 5.3 Flash" o "z-ai/glm-5.3-flash".
4. Click "Get API key" → "Generate new key".
5. La key empieza por `nvapi-...`.
6. Copia en `.env` → `NVIDIA_API_KEY=nvapi-...`.

> El `src/config/nvidia.ts` valida que la key **no** sea el placeholder (`nvapi-xxx`). Si lo es, lanza error y el proceso muere al arranque.

### 4.3. Apify (opcional, para discovery + research real)

Sin Apify, el pipeline usa `MockDiscoveryProvider` (3 restaurantes veganos de Medellín como fixture). Para discovery real:

1. Crea cuenta en [apify.com](https://apify.com/) (free tier: $5 credit).
2. Settings → Integrations → Personal API tokens → "Create new token".
3. Copia en `.env` → `APIFY_TOKEN=apify_api_...`.
4. Reinicia el bot. La próxima búsqueda usará `ApifyDiscoveryProvider` (actor `apify~google-search-scraper`).

> El actor se invoca vía `run-sync-get-dataset-items` (blocking HTTP request). Tiempo típico: 5–20 segundos por query.

### 4.4. SendGrid setup (outreach email)

1. Crea cuenta en [sendgrid.com](https://sendgrid.com/) (free tier: 100 emails/día para siempre).
2. **Verify a sender email**:
   - Settings → Sender Authentication → Verify a Single Sender.
   - Mete el email desde el que vas a enviar (ej. `ventas@tuempresa.com`).
   - SendGrid envía un email de confirmación. Haz click en el link.
3. **Create API key**:
   - Settings → API Keys → Create API Key.
   - Nombre: `AGENTE_LEADS_prod`.
   - Permissions: "Restricted Access" → Mail Send → "Full Access".
   - Copia la key (solo se muestra una vez) en `.env` → `SENDGRID_API_KEY=SG...`.
4. **From email** en `.env` → `SENDGRID_FROM_EMAIL=ventas@tuempresa.com`.
5. **Test**: en el bot, pídele `run_outreach` con `dry_run=false` sobre un lead con email validado. Si SendGrid está bien, el resultado incluye `message_id` (cabecera `x-message-id` de la API response).

> Si `SENDGRID_API_KEY` no está seteado, el pipeline de outreach usa `MockOutreachProvider` en modo dry_run (no envía, solo simula).

### 4.5. WhatsApp Cloud API setup (outreach WhatsApp)

1. Ve a [developers.facebook.com](https://developers.facebook.com/).
2. Click "Create App" → tipo "Business" → nombre "AGENTE-LEADS".
3. En el dashboard de la app: Add Product → WhatsApp Cloud API → "Set up".
4. En la sección WhatsApp → "API Setup":
   - Verás un **Phone Number ID** (ej. `107000123456789`). Cópialo → `.env` → `WHATSAPP_PHONE_NUMBER_ID=107000123456789`.
   - Verás un **Temporary Access Token**. Para prod, genera uno permanente en "System User Access Token" → "Add new" → WhatsApp Manager. → `.env` → `WHATSAPP_TOKEN=EAAG...`.
5. **Verify a phone number to send messages to** (en modo desarrollo, solo números verificados pueden recibir):
   - WhatsApp → "Phone Numbers" → "Add phone number" → mete tu número móvil.
   - Recibes un OTP por WhatsApp. Entra.
6. Para producción (enviar a cualquier número):
   - Meta Business verification (requiere documentos de la empresa).
   - Subir Message Template si vas a enviar mensajes con templates (no es requerido para mensajes de texto libre 1:1).
7. **Test**: pídele al bot `run_outreach` con `dry_run=false` sobre un lead con phone. Si WhatsApp está bien, el resultado incluye `message_id` de Meta Graph response.

> El código en `src/agent/providers/outreach.ts` valida que el teléfono sea 8-15 dígitos (regex). Si el lead tiene `phone` inválido, el outreach lo skippea con `INVALID_INPUT`.

### 4.6. CRM-ALBRA webhook setup

El webhook es **outbound** (AGENTE LEADS dispara eventos hacia tu CRM). Tu CRM debe exponer un endpoint que reciba POSTs JSON.

1. En tu CRM-ALBRA (o cualquier receptor), crea un endpoint:
   ```
   POST https://crm.tuempresa.com/api/agente-leads/webhook
   Authorization: Bearer <tu_secret>
   Content-Type: application/json
   X-AGENTE-LEADS-Event: lead.created | lead.scored | lead.intelligenced | lead.outreach_sent | execution.completed
   Body: { type, lead_id?, payload, fired_at }
   ```

2. En `.env` del bot:
   ```bash
   CRM_ALBRA_WEBHOOK_URL=https://crm.tuempresa.com/api/agente-leads/webhook
   CRM_ALBRA_SECRET=<un-secret-largo-y-aleatorio>
   ```

3. El bot firinga webhooks desde `src/agent/pipelines/crm_albra_hooks.ts`:
   - `lead.created` — cuando un lead se persiste por primera vez.
   - `lead.scored` — cuando el Scoring pipeline computa el Lead Score.
   - `lead.intelligenced` — cuando el LLM Intelligence produce un summary.
   - `lead.outreach_sent` — cuando outreach se envía de verdad (dry_run=false).
   - `execution.completed` — al final de cada pipeline run.

4. **Verificación**: si el webhook falla (non-2xx, timeout, DNS), el pipeline **no se cae** — el error se loguea y la cuenta interna `failedCount` incrementa. Puedes ver las stats con `crmHooks.getStats()`.

5. **Seguridad**: el secret se envía como `Authorization: Bearer <secret>`. En producción, considera migrar a HMAC-SHA256 signature en una cabecera `X-AGENTE-LEADS-Signature` (TODO — el código actual usa bearer simple, marcado en el comentario del archivo `crm_albra_hooks.ts`).

> Si `CRM_ALBRA_WEBHOOK_URL` está vacío, los hooks son silent no-op (no error).

---

## 5. Health checks y monitoring

### 5.1. Storage health

```typescript
import { checkStorageHealth } from "./src/agent/storage/lead_intelligence.js";

const health = checkStorageHealth();
// → { ok: true, tables: ["lead_intelligence_leads", "lead_intelligence_evidence", ...], dbPath: "./data/lead-intelligence.db" }
```

Llama esta función desde un endpoint HTTP `/health` si quieres monitoreo externo. Por ahora el bot no expone HTTP — solo responde a Telegram.

### 5.2. Log inspection

Tres tipos de logs:

- **Bot startup**: banner ASCII + líneas `[Boot]`.
- **Security**: `[Security] Blocked unauthorized user: <id>` — alguien fuera de whitelist intentó hablar.
- **Agent loop**: `[AgentLoop] ⚡ Orchestrating N tool calls in parallel...`, `[AgentLoop] 🔧 Tool call: <name>`, `[AgentLoop] ✅ Tool result from <name> completed.`, `[Bot] ✉️ User <id> → N iterations → replied`.
- **NVIDIA retry**: `[NVIDIA] <label> attempt N/M failed. Retrying in Xms… (<error>)`.
- **Intelligence fallback**: `[intelligence] LLM failed: <error>`.
- **Scrapling**: si el Python venv no está, verás `[Boot] ⚠️ Scrapling unavailable — .venv/bin/python not found` y el pipeline usará solo el Research provider.

### 5.3. PM2 monitoring

```bash
pm2 monit               # dashboard interactivo
pm2 status              # tabla de procesos
pm2 logs agente-leads --lines 100
pm2 describe agente-leads  # info detallada
```

### 5.4. SQLite inspection

```bash
# Conversaciones DB
sqlite3 ./data/agente-leads.db "SELECT COUNT(*) FROM conversations;"
sqlite3 ./data/agente-leads.db "SELECT user_id, COUNT(*) FROM conversations GROUP BY user_id;"

# Lead intelligence DB
sqlite3 ./data/lead-intelligence.db "SELECT COUNT(*) FROM lead_intelligence_leads;"
sqlite3 ./data/lead-intelligence.db "SELECT name, email, research_state FROM lead_intelligence_leads ORDER BY created_at DESC LIMIT 10;"
sqlite3 ./data/lead-intelligence.db "SELECT id, outcome, total_duration_ms, summary FROM executions ORDER BY started_at DESC LIMIT 5;"
sqlite3 ./data/lead-intelligence.db "SELECT * FROM dedup_matches ORDER BY created_at DESC LIMIT 10;"
```

### 5.5. Uptime monitoring externo

Recomendado: [UptimeRobot](https://uptimerobot.com/) o [Healthchecks.io](https://healthchecks.io/) con un cron job que corra `checkStorageHealth()` y reporte ping.

Si expones un endpoint `/health` HTTP (TODO — no implementado en V2), Healthchecks puede pingearlo cada minuto.

---

## 6. Backup strategy

### 6.1. Qué hacer backup

| Archivo | Frecuencia | Razón |
|---------|-----------|-------|
| `./data/lead-intelligence.db` | **Diaria + antes de cada deploy** | Crown jewels — todos los leads, evidencias, executions, dedup_matches |
| `./data/agente-leads.db` | Semanal (opcional) | Conversaciones — se pierden poco valor si se resetea |
| `.env` | En el primer deploy + en cada cambio | Sin esto el bot no arranca |
| `dist/` | En cada deploy | No es data pero asegura rollback rápido |

### 6.2. Cómo hacer backup (SQLite WAL)

SQLite WAL permite backups en caliente. Usa la API `.backup`:

```bash
# Backup en caliente (WAL lo permite)
sqlite3 ./data/lead-intelligence.db ".backup './backups/lead-intelligence-$(date +%Y%m%d-%H%M).db'"

# Comprimir
gzip ./backups/lead-intelligence-*.db

# Mantener solo los últimos 30 días
find ./backups -mtime +30 -delete
```

### 6.3. Script de backup automático

`scripts/backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/opt/agente-leads/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)

for db_file in /opt/agente-leads/data/*.db; do
  if [ -f "$db_file" ]; then
    backup_name="$(basename "$db_file" .db)-$TIMESTAMP.db"
    sqlite3 "$db_file" ".backup $BACKUP_DIR/$backup_name"
    gzip "$BACKUP_DIR/$backup_name"
    echo "[$TIMESTAMP] Backed up: $backup_name.gz"
  fi
done

# Limpieza: >30 días
find "$BACKUP_DIR" -mtime +30 -delete
```

Cron:

```cron
0 3 * * * /opt/agente-leads/scripts/backup.sh >> /var/log/agente-backup.log 2>&1
```

### 6.4. Restore

```bash
# Detener el bot primero
pm2 stop agente-leads   # o sudo systemctl stop agente-leads

# Restaurar
gunzip < ./backups/lead-intelligence-20240115-030000.db.gz > /opt/agente-leads/data/lead-intelligence.db

# Reanudar
pm2 start agente-leads
```

---

## 7. Troubleshooting

### 7.1. El bot no responde en Telegram

| Síntoma | Causa probable | Fix |
|---------|----------------|-----|
| BotFather responde, el bot no | `TELEGRAM_BOT_TOKEN` mal copiado o placeholder | Verifica `.env`. El código valida que no incluya `AAAAAAAA`. |
| Bot no arranca en boot | `ALLOWED_IDS` vacío | Aviso `[Telegram] ⚠️ ALLOWED_IDS is empty`. Rellena con tu user ID. |
| Bot arranca pero no responde a `/start` | Tu user ID no está en `ALLOWED_IDS` | Log dice `[Security] Blocked unauthorized user: <id>`. Agrega tu ID al .env y reinicia. |
| Bot responde "⚠️ Tuve un problema procesando…" | Excepción en agent loop | Revisa logs: `pm2 logs agente-leads --lines 100`. Suele ser `NVIDIA_API_KEY` inválido o API de NVIDIA caída. |
| Bot nunca termina de "typing…" | Pipeline colgado | Timeout de NVIDIA es 120s. Si pasa más, mata el proceso: `pm2 restart agente-leads`. Considera bajar `MAX_TOOL_ITERATIONS`. |

### 7.2. LLM timeouts

| Síntoma | Causa probable | Fix |
|---------|----------------|-----|
| `[NVIDIA] iteration N attempt 1/3 failed. Retrying… (timeout)` | NVIDIA NIM caído o rate limit | Espera. El retry exponencial (3 intentos, 1s × 2^n) debería recuperar. |
| `[NVIDIA] max attempts reached` | NVIDIA NIM caído persistente | Verifica [status.build.nvidia.com](https://status.build.nvidia.com/). Si persiste, baja `MAX_TOOL_ITERATIONS` a 5 temporalmente. |
| `[intelligence] LLM failed: Empty response` | GLM 5.3 Flash devolvió `content: null` | El código usa `makeFallbackIntelligence()` automáticamente. No es fatal. |
| `reasoning_content` no cabe en tokens | `max_tokens` too small | `NVIDIA_CONFIG.maxTokens = 4096`. Si ves truncation, sube a `8192` en `src/config/nvidia.ts`. |
| 502/503/529 de NVIDIA | Service overloaded | El retry los cubre (1s × 2^n × 3 intentos). Si falla, espera 60s y reintenta. |

### 7.3. DB locked

| Síntoma | Causa probable | Fix |
|---------|----------------|-----|
| `SQLITE_BUSY: database is locked` | Otra conexión a la misma DB file | **Solo una instancia del bot debe correr.** Si tienes PM2 con `instances: 2+`, bájalo a 1. Si tienes cron scripts que tocan la DB, móntalos en procesos separados. |
| `better-sqlite3 native destructor crash` (node crash al cerrar) | Cerrar DB con statements vivos | El código maneja esto con `process.on('beforeExit' + 'exit')` que cierra la DB antes del GC. No lo sobrescribas. |
| `EACCES` abriendo DB file | Permisos | `chown agente:agente /opt/agente-leads/data/*.db`. |
| DB file corrupta después de kill -9 | WAL no flusheado | Restore desde backup. Si no hay backup, prueba `sqlite3 db.db ".recover"` para salvar lo salvable. |

### 7.4. Scrapling no funciona

| Síntoma | Causa probable | Fix |
|---------|----------------|-----|
| `[Boot] ⚠️ Scrapling unavailable — .venv/bin/python not found` | Python venv no creado | `python3 -m venv .venv && .venv/bin/pip install -r src/agent/scripts/requirements.txt` |
| `python: command not found` | Python no instalado | Ubuntu: `sudo apt install python3 python3-pip python3-venv`. macOS: `brew install python`. |
| `ModuleNotFoundError: No module named 'scrapling'` | Requirements no instalados | `source .venv/bin/activate && pip install -r src/agent/scripts/requirements.txt` |
| Scrapling devuelve 403/Cloudflare | Site lo bloquea | **No es un bug** — Scrapling no evade CAPTCHAs. El provider devuelve `TEMPORARY_FAILURE` y el pipeline lo reporta honestamente. |
| `PROVIDER_UNAVAILABLE` en scraping | Venv missing | Revisa `scrapling_scraper.ts` → `isConfigured()` busca `.venv/bin/python`. |

### 7.5. Apify no funciona

| Síntoma | Causa probable | Fix |
|---------|----------------|-----|
| `[Apify] AUTH_FAILURE: APIFY_TOKEN not set` | Falta `.env` | Agrega `APIFY_TOKEN=apify_api_...`. Sin esto, se usa `MockDiscovery` (3 restaurantes veganos fixture). |
| `429 Too Many Requests` de Apify | Rate limit | Retry exponencial cubre, pero si persiste: baja frecuencia de uso, sube tier de Apify. |
| `EMPTY_RESULT` de Apify | Búsqueda sin resultados | Reformula el query. El pipeline no reintenta ni hace fallback en `EMPTY_RESULT` (es legítimo). |
| Apify tarda mucho | `run-sync-get-dataset-items` es blocking | Típico: 5-20s por query. Si más, baja `max_concurrency` a 2. |

### 7.6. Outreach no envía

| Síntoma | Causa probable | Fix |
|---------|----------------|-----|
| `Email provider: Mock (SENDGRID_API_KEY not set)` | Falta env var | Agrega `SENDGRID_API_KEY` y `SENDGRID_FROM_EMAIL`. Reinicia. |
| `Email provider: SendGrid (configured)` pero `failed: 403` | Sender email no verificado | SendGrid → Sender Authentication → Verify single sender. |
| `failed: 550` de SendGrid | Recipient bounced/unsubscribed | SendGrid te lo reporta en tu dashboard. Marca el lead como no-contactable. |
| WhatsApp `401 Unauthorized` | Token inválido o expirado | Meta → System Users → generate permanent token. |
| WhatsApp `403 Forbidden` | Número del lead no verificado (modo desarrollo) | En dev mode solo envías a números verificados. Para prod, completa Meta Business verification. |
| Outreach siempre en `dry_run` | `dry_run=true` default | En el bot, el LLM debe pasar `dry_run=false` explícito. El system prompt dice "pregunta al usuario antes". |
| `skipped: no_contact_channel` | Lead no tiene email validado ni phone | Normal. El lead necesita `validation.email.status==="valid"` o un phone en cualquier estado. |
| `skipped: below_score_threshold` | Lead Score < 50 | Normal. Sube `min_score` o invoca `run_lead_pipeline` con `offer_description` para correr intelligence. |

### 7.7. CRM webhook no llega

| Síntoma | Causa probable | Fix |
|---------|----------------|-----|
| Webhook stats: `failed: 5, sent: 0` | Tu CRM no responde 2xx | Verifica el endpoint con `curl -X POST https://crm.tuempresa.com/api/agente-leads/webhook -H "Authorization: Bearer <secret>" -H "Content-Type: application/json" -d '{}'`. Debe responder 200/202. |
| Timeout 10s | CRM lento | El código usa `AbortSignal.timeout(10_000)`. Si tu CRM tarda más, sube el timeout en `crm_albra_hooks.ts`. |
| `CRM_ALBRA_WEBHOOK_URL` vacío | Hooks deshabilitados a propósito | OK si no tienes CRM. Es un silent no-op. |

---

## 8. Performance tuning

### 8.1. `max_concurrency` (parallelismo de batches)

En el tool `run_lead_pipeline`, el LLM puede pasar `max_concurrency`. Default: 3.

```typescript
// src/agent/pipelines/orchestrator.ts
const concurrency = intent.max_concurrency ?? 3;
// Research batches: concurrency
// Validation batches: concurrency
// Dedup+Storage batches: floor(concurrency / 2)  — DB writes
// Scoring batches: concurrency
// Intelligence batches: floor(concurrency / 2)   — LLM calls
```

**Recomendaciones**:

| Escenario | `max_concurrency` | Razón |
|-----------|-------------------|-------|
| Demo / dev | 3 (default) | Suficiente para 5-10 candidates |
| Producción normal | 3-5 | Apify + Scrapling toleran 5 concurrent |
| Producción scaled | 8-10 | NVIDIA NIM no documenta rate limits estrictos. Apify tier-free soporta ~10 req/s. |
| Sin Apify (solo MockDiscovery) | 10-15 | Solo scraping + verification — sube el parallelismo |

> Si subes `max_concurrency` por encima de 10, observa logs de NVIDIA para 429s. Si aparecen, baja.

### 8.2. `MAX_TOOL_ITERATIONS` (limite de iteraciones del agent loop)

En `.env`:

```bash
MAX_TOOL_ITERATIONS=10   # default
```

- Subir a 15 si el LLM necesita múltiples llamadas al pipeline (por ejemplo, reformula query y reintenta).
- Bajar a 5 si quieres acotar costos de tokens NVIDIA.
- Si el LLM pega el safety exit ("He alcanzado el límite de razonamiento"), súbelo.

### 8.3. NVIDIA NIM tuning

`src/config/nvidia.ts`:

```typescript
export const NVIDIA_CONFIG = {
  model: "z-ai/glm-5.3-flash",
  contextWindow: 128_000,
  maxTokens: 4_096,          // bumped for reasoning + answer
  temperature: 0.5,
  topP: 1,
  retry: {
    maxAttempts: 3,
    initialDelayMs: 1_000,
    backoffFactor: 2,
  },
};
// timeout: 120_000ms (2 min) — GLM 5.3 Flash reasoning puede tomar 30-60s
```

- `temperature: 0.5` — equilibrio entre determinismo (tool-calling) y creatividad (outreach proposals). Si las propuestas salen muy genéricas, sube a 0.7. Si el tool-calling falla mucho, baja a 0.3.
- `maxTokens: 4096` — suficiente para reasoning + answer. Si ves `finish_reason: "length"` en logs, sube a 8192.
- `timeout: 120s` — GLM 5.3 Flash es un modelo de razonamiento y tarda 30-60s en algunas queries complejas. **No bajar**.

### 8.4. SQLite WAL tuning

```typescript
// src/agent/storage/lead_intelligence.ts
conn.pragma("journal_mode = WAL");
conn.pragma("foreign_keys = ON");
```

Si tienes escritura intensiva (muchos pipeline runs en paralelo), considera agregar:

```typescript
conn.pragma("synchronous = NORMAL");   // faster, slight risk on power loss
conn.pragma("busy_timeout = 5000");     // wait up to 5s on lock
```

Pero **no lo necesitas** con `instances: 1` en PM2 (recomendado).

### 8.5. Memory tuning (PM2 / systemd)

- `max_memory_restart: '500M'` en PM2 — reinicia si el proceso crece mucho (fuga eventual de better-sqlite3 statements).
- Node `--max-old-space-size=1024` si ves OOMs en máquinas pequeñas.

### 8.6. Disk space

- SQLite WAL crece hasta ~1.5x del DB principal durante escrituras largas. Si el DB es 100MB, espera pico de 250MB durante un pipeline run grande.
- Logs PM2: rota con `max-size: "10m", max-file: "5"` = 50MB máx.
- Backups: con gzip, ~1/4 del original. 30 días de backups diarios ~ 100-500MB.

### 8.7. Network egress

Llamadas externas por pipeline run (10 candidates, default):

| Servicio | Calls | Tiempo total |
|----------|-------|--------------|
| NVIDIA NIM (agent loop) | 1-5 | 5-60s |
| NVIDIA NIM (intelligence) | 1-10 | 5-60s |
| NVIDIA NIM (outreach proposals) | 0-10 | 0-60s |
| Apify (discovery) | 1 | 5-20s |
| Apify (research) | 1-10 (paralelo 3) | 15-60s |
| RapidEmailVerifier | 1-20 (paralelo 3) | 5-30s |
| Scrapling (Python) | 1-10 (paralelo 3) | 10-60s |
| SendGrid (email outreach) | 0-N | <5s |
| WhatsApp Cloud API | 0-N | <3s |
| CRM webhook | 0-N | <2s |

Tiempo total de un pipeline run completo: 30-180s para 10 candidates. El bot responde "typing…" mientras tanto.

---

## 9. Checklist pre-producción

Antes de promover a prod:

- [ ] `.env` con todas las variables obligatorias (`NVIDIA_API_KEY`, `TELEGRAM_BOT_TOKEN`, `ALLOWED_IDS`) + opcionales que vayas a usar.
- [ ] `.env` con permisos `chmod 600` y dueño correcto.
- [ ] `npm run typecheck` pasa sin errores.
- [ ] `npm test` pasa (todos los tests OK).
- [ ] `npm run build` genera `dist/`.
- [ ] `/start`, `/clear`, `/memory` funcionan en Telegram desde tu user ID.
- [ ] Una búsqueda real ("restaurantes veganos en Medellín") devuelve un TOP LEADS report.
- [ ] `run_outreach` con `dry_run=true` genera propuestas.
- [ ] Si `dry_run=false`: SendGrid/WhatsApp responden con `message_id`.
- [ ] Backups nightly programados y verificados (restore test).
- [ ] PM2/systemd arranca el bot en boot del servidor.
- [ ] Logs rotando (no crecen indefinidamente).
- [ ] Uptime monitoring configurado (UptimeRobot/Healthchecks).
- [ ] Documentación a tu equipo: dónde está el .env, cómo reiniciar, cómo hacer backup.

---

## 10. Rollback

Si una versión nueva rompe:

```bash
# PM2
pm2 stop agente-leads
git checkout <previous-tag>      # o git stash si cambios sin commitear
npm ci                            # reinstalar deps del lockfile
npm run build
pm2 start agente-leads

# systemd
sudo systemctl stop agente-leads
cd /opt/agente-leads
sudo -u agente git fetch && sudo -u agente git checkout <previous-tag>
sudo -u agente npm ci --omit=dev
sudo -u agente npm run build
sudo systemctl start agente-leads

# Docker
docker compose down
docker compose pull   # o checkout del commit anterior
docker compose up -d --build
```

Si la DB schema cambió de forma incompatible (no debería — todas las migraciones son `CREATE TABLE IF NOT EXISTS`):

```bash
# Restaurar DB de la noche anterior
pm2 stop agente-leads
gunzip < ./backups/lead-intelligence-<ayer>.db.gz > ./data/lead-intelligence.db
pm2 start agente-leads
```

---

## 11. Upgrade path

Para aplicar upgrades menores (sin breaking changes):

1. `git pull origin main`
2. `npm ci` (respeta lockfile)
3. `npm run typecheck && npm test`
4. `npm run build`
5. `pm2 restart agente-leads` (o `sudo systemctl restart agente-leads`)
6. Verificar `/start` en Telegram
7. Hacer una búsqueda de prueba

Para upgrades mayores (cambios de schema o breaking changes), seguir el rollback path si algo falla. **Siempre hacer backup de DB antes de upgrade mayor.**

---

## 12. Contacto y soporte

- **Repo principal**: `https://github.com/ALBRA8/AGENTE-LEADS`
- **Issues**: GitHub Issues para bugs / feature requests.
- **Documentación interna**:
  - `README.md` — visión general.
  - `ARCHITECTURE.md` — arquitectura técnica profunda.
  - `DEPLOYMENT.md` — este archivo.

Para preguntas de deployment, adjuntar siempre:
- Output de `npm run typecheck`
- Output de `pm2 logs agente-leads --lines 100` (o equivalente)
- Versión de Node.js (`node --version`)
- Versión del código (`git rev-parse HEAD`)
- Tipo de deployment (PM2 / systemd / Docker / bare metal)
