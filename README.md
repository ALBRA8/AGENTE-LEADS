# AGENTE LEADS — Autonomous Lead Intelligence

> Bot de Telegram autónomo para prospección B2B con LLM, pipelines determinísticos, evidencia por campo y outreach vía APIs oficiales.

![status](https://img.shields.io/badge/status-V2%20stable-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![llm](https://img.shields.io/badge/LLM-GLM%205.3%20Flash-orange)

---

## ¿Qué hace?

AGENTE LEADS es un agente conversacional de Telegram que, ante una solicitud en lenguaje natural (por ejemplo *"restaurantes veganos en Medellín con más de 5.000 seguidores"*), ejecuta un pipeline determinístico para descubrir candidatos, investigarlos, validar la información contra fuentes externas, deduplicarlos por multi-señal, puntuarlos, generar inteligencia con LLM y, opcionalmente, enviar propuestas comerciales personalizadas por email (SendGrid) o WhatsApp (Cloud API). Cada dato del reporte lleva etiqueta de **observado / validado / no encontrado / inferido**, y la regla de oro del sistema es: **"no encontrado" ≠ "no tiene"**.

---

## Arquitectura

```
                         ┌──────────────────────────────┐
                         │            USUARIO            │
                         │  (Telegram — texto / voz)    │
                         └──────────────┬───────────────┘
                                        │
                                        ▼
                         ┌──────────────────────────────┐
                         │        CAPA TELEGRAM          │  grammy · long polling
                         │  Whitelist · /start /clear    │
                         └──────────────┬───────────────┘
                                        │ userMessage
                                        ▼
                         ┌──────────────────────────────┐
                         │       CAPA LLM (AGENT)        │  GLM 5.3 Flash
                         │  System prompt en español    │  NVIDIA NIM
                         │  Tool-calling automático     │  max 10 iteraciones
                         └──────────────┬───────────────┘
                                        │ run_lead_pipeline / run_outreach
                                        ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │                       CAPA PIPELINES (ORQUESTADOR)                  │
   │                                                                     │
   │  DISCOVERY → RESEARCH → VALIDATION → EVIDENCE → DEDUP →             │
   │  SCORING → INTELLIGENCE → STORAGE → REPORT → CRM-ALBRA              │
   │                                                                     │
   │  · Batches paralelos (max_concurrency default 3)                    │
   │  · ExecutionTrace persistido en cada run                            │
   └──┬──────────────┬──────────────┬──────────────┬─────────────┬──────┘
      │              │              │              │             │
      ▼              ▼              ▼              ▼             ▼
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ DISCOVERY│  │ RESEARCH │  │   VERIFY │  │ SCRAPING │  │ OUTREACH │
│ Apify /  │  │ Google   │  │ RapidEml │  │ Scrapling│  │ SendGrid │
│ Mock     │  │ Search   │  │ Fly.io   │  │ (Python) │  │ WhatsApp │
└──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
      │              │              │              │             │
      └──────────────┴──────────────┴──────────────┴─────────────┘
                                        │
                                        ▼
                  ┌──────────────────────────────────────┐
                  │   STORAGE (SQLite WAL — dos DBs)      │
                  │  · agente-leads.db  (conversaciones) │
                  │  · lead-intelligence.db  (leads)     │
                  └──────────────────────────────────────┘
                                        │
                                        ▼
                  ┌──────────────────────────────────────┐
                  │         REPORT (Markdown)            │
                  │   observado / validado / inferido   │
                  └──────────────────────────────────────┘
```

---

## Características clave

- 🤖 **Agente conversacional** con GLM 5.3 Flash (NVIDIA NIM) — razona con `reasoning_content` antes de responder.
- 🛠️ **Tool-calling** — el LLM decide qué pipeline invocar (`run_lead_pipeline`, `run_outreach`, herramientas legacy).
- 🔁 **Pipeline determinístico de 10 etapas** — discovery → research → validation → evidence → dedup → scoring → intelligence → storage → report → CRM hook.
- 🧠 **Inteligencia con LLM** — GLM 5.3 Flash produce summary, opportunity_size, outreach_angle y confidence por lead, **sin inventar datos**.
- 📊 **Lead Score 0–100** transparente (validación + evidencia FOUND + cross-source consistency + research_state).
- 🔍 **Motor de evidencia por campo** — cada campo sabe si fue FOUND, NOT_FOUND, CONFIRMED_ABSENT o INFERRED.
- 🚫 **Regla P0.6** — "no encontrado" nunca se reporta como "no tiene".
- 🧬 **Deduplicación multi-señal** — EXACT (email/website) → STRONG (instagram/phone/domain) → PROBABLE (name+location).
- 🛡️ **Whitelist de Telegram** — solo `ALLOWED_IDS` pueden hablar con el bot.
- 📨 **Outreach con APIs oficiales** — SendGrid v3 + WhatsApp Cloud API v21.0. Sin bots, sin CAPTCHA bypass.
- 🧪 **DRY RUN por defecto** — el outreach nunca envía sin `dry_run=false` explícito.
- 🗃️ **Storage separado** — conversaciones en `agente-leads.db`, leads en `lead-intelligence.db` (SQLite WAL).
- 📡 **CRM-ALBRA hooks** — webhook opcional para integración futura con CRM (no implementado como CRM completo).
- 🧯 **Taxonomía de errores normalizada** — `OK / TEMPORARY_FAILURE / AUTH_FAILURE / RATE_LIMIT / EMPTY_RESULT / INVALID_INPUT / TIMEOUT / PROVIDER_UNAVAILABLE`.
- 📈 **Observabilidad** — `ExecutionTrace` con steps, duraciones y errores por cada pipeline.
- ✅ **Suite de tests** — 13 archivos (12 capas + E2E), `--test-concurrency=1` para evitar el native crash de better-sqlite3.

---

## Quick start

```bash
# 1. Clonar
git clone https://github.com/ALBRA8/AGENTE-LEADS.git
cd AGENTE-LEADS

# 2. Instalar dependencias
npm install

# 3. (Opcional) Crear venv de Python para el scraper stealth
python3 -m venv .venv
source .venv/bin/activate
pip install -r src/agent/scripts/requirements.txt
deactivate

# 4. Configurar variables de entorno
cp .env.example .env
#  → rellena NVIDIA_API_KEY, TELEGRAM_BOT_TOKEN y ALLOWED_IDS como mínimo

# 5. Modo desarrollo (hot reload con tsx watch)
npm run dev

# 6. Producción (build + start)
npm run build
npm start
```

Si todo arranca, verás:

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

---

## Herramientas disponibles para el LLM

| Tool | Descripción | Cuándo la usa el LLM |
|------|-------------|----------------------|
| `run_lead_pipeline` | Pipeline determinístico completo: descubrir → investigar → validar → dedup → scoring → intelligence → storage → report | Cuando el usuario pide buscar leads (caso default) |
| `run_outreach` | Genera propuestas personalizadas con LLM y (opcionalmente) las envía por email/WhatsApp | Después de `run_lead_pipeline`, cuando el usuario quiere contactar leads |
| `scrape_instagram_leads` | Descubrimiento puntual vía Apify (legacy) | Casos puntuales que requieren Apify directamente |
| `enrich_lead_profile` | Enriquecimiento de un lead con Google Search (legacy, infraestructura) | Cuando se necesita enriquecer un lead específico |
| `verify_email` | Verificación puntual de un email | Cuando se pregunta por un email concreto |
| `scrape_stealth` | Extracción de una URL con Scrapling (Python) | Cuando se necesita scrapear una URL específica |
| `save_lead` | Guardar un lead individual (legacy, SQLite) | Persistencia manual legacy |
| `get_current_time` | Devuelve fecha/hora actual | Cuando el usuario pregunta la hora |

> Las tools "legacy" se mantienen por compatibilidad hacia atrás. Para flujos nuevos, el LLM está instruido a preferir `run_lead_pipeline` y `run_outreach`.

---

## Comandos de Telegram

| Comando | Descripción | Estado |
|---------|-------------|--------|
| `/start` | Mensaje de bienvenida + capacidades del agente | ✅ Implementado |
| `/clear` | Borra el historial de conversación del usuario en SQLite | ✅ Implementado |
| `/memory` | Muestra los fragmentos de memoria que el agente tiene del usuario | ✅ Implementado |
| `/help` | — | ⚠️ No implementado (planned) |
| `/stats` | — | ⚠️ No implementado (planned) |

Cualquier mensaje de texto se procesa con el agente loop. Las notas de voz se descargan pero la transcripción (Whisper) **aún no está implementada** — el handler deja un placeholder.

---

## Ejemplos de consultas en lenguaje natural

```
👤 Busca restaurantes veganos en Medellín con más de 5.000 seguidores

🤖 [invoca run_lead_pipeline con query="restaurantes veganos"
     location="Medellín" min_followers=5000 niche="vegano"]

# TOP LEADS — AGENTE LEADS
_Solicitud:_ restaurantes veganos en Medellín con más de 5.000 seguidores
_Leads encontrados:_ 2
_Mostrando top:_ 2

## 1. Vegan Heaven Medellín

| Campo       | Valor                        | Estado      | Confianza |
|-------------|------------------------------|-------------|-----------|
| Instagram   | veganheavenmed               | encontrado  | alta      |
| Website     | https://veganheaven.com.co   | encontrado  | media     |
| Email        | hello@veganheaven.com        | encontrado  | media     |
| Email        | (validado)                   | validado    | alta      |
| Teléfono    | —                            | no encontrado | baja   |
...

---

👤 Ahora envíales propuestas a los dos. Mi oferta es:
   "Diseño web para restaurantes veganos con plantilla plant-based"

🤖 [invoca run_outreach con offer_description="..." dry_run=true
     (default — el agente siempre pregunta antes de enviar de verdad)]

# Outreach (DRY RUN)
- Total leads analizados: 2
- Enviados: 0   Skipped: 0   (dry_run=true)

## Vegan Heaven Medellín (score 78/100) — DRY_RUN
- Canal: email (hello@veganheaven.com validado)
**Propuesta generada (preview):**
Hola Vegan Heaven,
Tu sitio web actual carece de HTTPS... [recorte]
```

```
👤 ¿Tienen los leads guardados dirección de LinkedIn?

🤖 De los 2 leads en lead-intelligence.db:
   - Vegan Heaven Medellín: LinkedIn NO ENCONTRADO
     (se buscó pero no apareció en las fuentes consultadas —
      no afirmo que no tengan, solo que no lo encontré).
   - La Raíz Vegana: LinkedIn NO ENCONTRADO (idem).
```

> El agente respetará siempre la regla P0.6: nunca afirmará "no tiene X" si la búsqueda simplemente no lo encontró.

---

## Referencia de configuración (`.env`)

| Variable | Descripción | Default | Obligatoria |
|----------|-------------|---------|-------------|
| `NVIDIA_API_KEY` | API key de NVIDIA NIM (GLM 5.3 Flash) | — | ✅ Sí |
| `TELEGRAM_BOT_TOKEN` | Token del bot desde @BotFather | — | ✅ Sí |
| `ALLOWED_IDS` | Lista separada por comas de Telegram user IDs con acceso | — | ✅ Sí |
| `DB_PATH` | Path a la DB de conversaciones | `./data/agente-leads.db` | No |
| `LEADS_DB_PATH` | Path a la DB de lead intelligence | `./data/lead-intelligence.db` | No |
| `AGENT_NAME` | Nombre mostrado en el banner de boot | `AGENTE LEADS` | No |
| `MAX_TOOL_ITERATIONS` | Máximo de iteraciones del agent loop | `10` | No |
| `LOG_LEVEL` | Nivel de logging | `info` | No |
| `APIFY_TOKEN` | Token de Apify (para discovery/research real). Si falta, se usa `MockDiscovery` | — | No |
| `SENDGRID_API_KEY` | API key de SendGrid para outreach email | — | Solo para outreach real |
| `SENDGRID_FROM_EMAIL` | Email emisor verificado en SendGrid | — | Solo para outreach real |
| `WHATSAPP_TOKEN` | Token de WhatsApp Cloud API | — | Solo para outreach WhatsApp |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone Number ID de Meta Business | — | Solo para outreach WhatsApp |
| `CRM_ALBRA_WEBHOOK_URL` | URL del webhook del CRM receptor | — | No |
| `CRM_ALBRA_SECRET` | Secret compartido para auth del webhook | — | No |

> Copia `.env.example` a `.env` y rellena al menos las tres variables obligatorias. Sin `APIFY_TOKEN`, el pipeline seguirá funcionando en modo demo con `MockDiscovery` (3 restaurantes veganos de Medellín como fixture).

---

## Testing

```bash
# Suite completa (12 capas + E2E), --test-concurrency=1
npm test

# Solo el test E2E
npm run test:e2e

# Type-check sin emitir dist/
npm run typecheck

# Build de producción
npm run build
```

### Cobertura de tests

| Archivo | Capa (P0/P1/P2) | # tests |
|---------|-----------------|---------|
| `tests/lead.test.ts` | P0.1 — Lead canónico + dedup signatures | 9 |
| `tests/evidence.test.ts` | P0.6 — EvidenceRecord + statusLabel | 8 |
| `tests/errors.test.ts` | P0.10 — Taxonomía de errores + normalizeError | 17 |
| `tests/execution.test.ts` | P0.11 — ExecutionRecorder + ExecutionTrace | 7 |
| `tests/providers.test.ts` | P0.2 — 4 interfaces de providers | 12 |
| `tests/discovery.test.ts` | P0.3 — Discovery pipeline con fallback | 6 |
| `tests/research.test.ts` | P0.4 — Research pipeline + evidencia | 8 |
| `tests/validation.test.ts` | P0.5 — Validation pipeline + cross-source | 7 |
| `tests/dedup.test.ts` | P0.7 — Multi-signal dedup | 8 |
| `tests/storage.test.ts` | P0.8 — Lead intelligence DB | 12 |
| `tests/report.test.ts` | P0.12 — Report engine | 12 |
| `tests/scoring.test.ts` | P1.1 — Lead Score 0–100 | var. |
| `tests/intelligence.test.ts` | P1.2 — LLM intelligence (con fake) | var. |
| `tests/quality.test.ts` | P1.4 — Provider metrics | var. |
| `tests/e2e.test.ts` | E2E — Pipeline completo con fakes | 6 subtests |

> La suite usa `--test-concurrency=1` por un bug conocido de `better-sqlite3` con workers paralelos (native destructor crash).

---

## Estructura del proyecto

```
AGENTE-LEADS/
├── .env.example                  # Variables de entorno documentadas
├── package.json                  # Scripts: dev, build, typecheck, test
├── tsconfig.json                 # ESM + strict mode
├── README.md                     # Este archivo
├── ARCHITECTURE.md               # Arquitectura técnica profunda
├── DEPLOYMENT.md                 # Guía de deployment producción
│
├── src/
│   ├── index.ts                  # Entry point — arranca Telegram bot
│   │
│   ├── config/
│   │   └── nvidia.ts             # Cliente NVIDIA NIM + retry/backoff
│   │
│   ├── bot/
│   │   └── telegram.ts           # Bot grammy — whitelist + comandos
│   │
│   ├── database/
│   │   └── sqlite.ts             # DB conversaciones + memory fragments
│   │
│   └── agent/
│       ├── loop.ts               # Agent loop (LLM + tool-calling)
│       ├── registry.ts           # Registro central de tools
│       ├── types.ts              # Tool / AgentInput / AgentOutput
│       │
│       ├── core/
│       │   ├── lead.ts           # P0.1 — Lead canónico + dedup signature
│       │   ├── evidence.ts       # P0.6 — ObservationStatus + helpers
│       │   ├── errors.ts         # P0.10 — ErrorType + normalizeError
│       │   ├── execution.ts      # P0.11 — ExecutionRecorder
│       │   └── index.ts          # Barrel
│       │
│       ├── providers/
│       │   ├── types.ts          # 4 interfaces (Discovery/Research/Verify/Scraping)
│       │   ├── apify_discovery.ts
│       │   ├── google_search_research.ts
│       │   ├── scrapling_scraper.ts
│       │   ├── email_verifier_provider.ts
│       │   ├── mock_discovery.ts
│       │   ├── outreach.ts       # SendGrid + WhatsApp Cloud
│       │   ├── registry.ts       # buildProviderRegistry()
│       │   └── index.ts          # Barrel
│       │
│       ├── pipelines/
│       │   ├── discovery.ts      # P0.3
│       │   ├── research.ts       # P0.4
│       │   ├── validation.ts     # P0.5
│       │   ├── dedup.ts          # P0.7
│       │   ├── scoring.ts        # P1.1 — Lead Score 0–100
│       │   ├── intelligence.ts   # P1.2 — LLM reasoning
│       │   ├── quality.ts        # P1.4 — Provider metrics
│       │   ├── orchestrator.ts   # P0.9 + P1.3 — runLeadPipeline
│       │   ├── outreach.ts       # P2.4 — Proposals + send
│       │   ├── crm_albra_hooks.ts# P2.3 — Webhook hooks
│       │   ├── report.ts         # P0.12 — Markdown report
│       │   └── index.ts          # Barrel
│       │
│       ├── storage/
│       │   └── lead_intelligence.ts # P0.8 — Lead DB (separada)
│       │
│       ├── tools/
│       │   ├── run_lead_pipeline.ts   # V2 tool
│       │   ├── run_outreach.ts        # V2 tool
│       │   ├── get_current_time.ts    # legacy
│       │   ├── scrape_instagram_leads.ts # legacy
│       │   ├── enrich_lead_profile.ts # legacy
│       │   ├── verify_email.ts        # legacy
│       │   ├── scrape_stealth.ts      # legacy
│       │   └── save_lead.ts           # legacy
│       │
│       ├── utils/
│       │   └── python_bridge.ts       # Llama a stealth_scraper.py
│       │
│       └── scripts/
│           ├── stealth_scraper.py     # Scrapling fetcher
│           └── requirements.txt       # Python deps
│
└── tests/
    ├── setup.ts                 # Helpers comunes
    ├── lead.test.ts             # P0.1
    ├── evidence.test.ts          # P0.6
    ├── errors.test.ts            # P0.10
    ├── execution.test.ts          # P0.11
    ├── providers.test.ts         # P0.2
    ├── discovery.test.ts         # P0.3
    ├── research.test.ts          # P0.4
    ├── validation.test.ts        # P0.5
    ├── dedup.test.ts             # P0.7
    ├── storage.test.ts          # P0.8
    ├── report.test.ts            # P0.12
    ├── scoring.test.ts           # P1.1
    ├── intelligence.test.ts      # P1.2
    ├── quality.test.ts           # P1.4
    └── e2e.test.ts               # E2E
```

---

## Licencia

MIT License (ficticia, declarada para el proyecto).

```
MIT License

Copyright (c) 2024 AGENTE-LEADS contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND...
```

---

## Estado

![status](https://img.shields.io/badge/status-V2%20stable-blue)
![phase](https://img.shields.io/badge/phase-P3%20documentation-orange)
![tests](https://img.shields.io/badge/tests-passing-brightgreen)

**Implementado en V2:**
- ✅ P0.1–P0.12 — Foundation (lead canónico, evidence, dedup, storage, pipelines, report)
- ✅ P1.1 — Lead Score 0–100
- ✅ P1.2 — LLM Intelligence con GLM 5.3 Flash
- ✅ P1.3 — Batches paralelos en research/validation/dedup/scoring/intelligence
- ✅ P1.4 — Quality metrics per provider
- ✅ P2.1 — SendGrid email outreach
- ✅ P2.2 — WhatsApp Cloud API outreach
- ✅ P2.3 — CRM-ALBRA webhook hooks
- ✅ P2.4 — Outreach pipeline con DRY RUN por defecto

**No implementado (out of scope P3+):**
- ❌ Transcripción de notas de voz (Whisper)
- ❌ Dashboard web
- ❌ CRM completo (solo webhook hooks)
- ❌ Scoring con ML
- ❌ Más providers (LinkedIn, Twitter, Facebook)
- ❌ Comandos `/help` y `/stats` en Telegram

Para detalles técnicos profundos, ver [`ARCHITECTURE.md`](./ARCHITECTURE.md).
Para deployment en producción, ver [`DEPLOYMENT.md`](./DEPLOYMENT.md).
