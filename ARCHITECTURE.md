# ARCHITECTURE — AGENTE LEADS V2

> Documento técnico profundo para contribuidores. Cubre la separación por capas, el flujo del pipeline, la abstracción de providers, la taxonomía de errores, el motor de evidencia, el Lead Score, la inteligencia LLM, el outreach y la separación de storage.

---

## 1. Visión general

AGENTE LEADS es un agente conversacional de Telegram que combina:
- un **LLM** (GLM 5.3 Flash vía NVIDIA NIM) que razona y decide qué hacer,
- un **pipeline determinístico** que ejecuta cómo hacerlo,
- una **capa de providers** abstraída detrás de interfaces,
- un **motor de evidencia** que etiqueta cada dato observado/validado/inferido,
- dos **DBs SQLite separadas** (conversaciones vs. lead intelligence).

El LLM **nunca** ejecuta directamente scrapers ni APIs de outreach. Siempre invoca tools de alto nivel (`run_lead_pipeline`, `run_outreach`) que disparan el orquestador. Esto garantiza que el comportamiento sea reproducible y testeable.

---

## 2. Separación por capas

```
┌─────────────────────────────────────────────────────────────────┐
│  1. TELEGRAM      — grammy, long polling, whitelist, /start /clear /memory │
├─────────────────────────────────────────────────────────────────┤
│  2. LLM            — GLM 5.3 Flash, system prompt, tool-calling, retry  │
├─────────────────────────────────────────────────────────────────┤
│  3. TOOLS         — registry central, run_lead_pipeline, run_outreach + legacy │
├─────────────────────────────────────────────────────────────────┤
│  4. PIPELINES    — orchestrator + 9 stages (deterministic)              │
├─────────────────────────────────────────────────────────────────┤
│  5. PROVIDERS    — 4 interfaces: Discovery / Research / Verification / Scraping │
│                    + 2 interfaces de outreach: Email / WhatsApp          │
├─────────────────────────────────────────────────────────────────┤
│  6. EVIDENCE      — ObservationStatus: FOUND/NOT_FOUND/CONFIRMED_ABSENT/INFERRED │
├─────────────────────────────────────────────────────────────────┤
│  7. SCORING      — Lead Score 0-100 (transparent, deterministic)        │
├─────────────────────────────────────────────────────────────────┤
│  8. INTELLIGENCE  — LLM reasoning (summary, opportunity, angle, conf) │
├─────────────────────────────────────────────────────────────────┤
│  9. STORAGE       — SQLite WAL × 2 (conversations vs. lead intel)      │
├─────────────────────────────────────────────────────────────────┤
│ 10. REPORT         — Markdown + JSON, con leyenda observado/validado/... │
├─────────────────────────────────────────────────────────────────┤
│ 11. CRM HOOKS    — Webhook opcional para CRM-ALBRA (o cualquier CRM)    │
└─────────────────────────────────────────────────────────────────┘
```

### Responsabilidad de cada capa

**TELEGRAM** (`src/bot/telegram.ts`): Frontend conversacional. Recibe texto (y voz, pendiente de transcripción). Aplica whitelist de `ALLOWED_IDS`. Persiste usuario en `users` table. Pasa el mensaje al agent loop. Es la única capa acoplada a grammy; el resto del código es agnóstico.

**LLM** (`src/agent/loop.ts` + `src/config/nvidia.ts`): El cerebro. Recibe el mensaje del usuario, reconstruye el historial desde SQLite, inyecta un system prompt en español que describe las tools disponibles y las reglas ("no afirmes capacidades que no tienes", "no encontrado ≠ no tiene"). Itera hasta `MAX_TOOL_ITERATIONS` (default 10). Cada iteración puede devolver texto final (stop) o uno o más tool_calls. Los tool_calls se ejecutan en paralelo (`Promise.all`) y los resultados se reinyectan. Las llamadas a NVIDIA NIM tienen retry exponencial (3 intentos, backoff factor 2) para timeout/502/503/529/ECONNRESET.

**TOOLS** (`src/agent/registry.ts` + `src/agent/tools/`): Registry central. Cada tool implementa la interfaz `Tool` (definition + execute). El LLM ve los schemas OpenAI de cada tool. Las V2 son `run_lead_pipeline` (invoca el orquestador determinístico) y `run_outreach` (pipeline de outreach). Las legacy se mantienen por compatibilidad.

**PIPELINES** (`src/agent/pipelines/`): El orquestador `runLeadPipeline` ejecuta 9 etapas en orden, con batches paralelos (default `max_concurrency=3`). Cada etapa produce datos estructurados (`CandidateLead`, `Lead`, `LeadScore`, `LeadIntelligence`) y deja rastro en `ExecutionRecorder`.

**PROVIDERS** (`src/agent/providers/`): 4 interfaces canónicas (`DiscoveryProvider`, `ResearchProvider`, `VerificationProvider`, `ScrapingProvider`) + 2 de outreach (`EmailOutreachProvider`, `WhatsAppOutreachProvider`). Cada provider devuelve `ProviderResult<T>` (ok o fail con `ProviderError`). El orquestador nunca ve SDKs específicos ni excepciones provider-specific.

**EVIDENCE** (`src/agent/core/evidence.ts`): El motor de verdad. Cada campo importante de un Lead (email, website, phone, instagram, linkedin, location) lleva un `EvidenceRecord` con `status`, `source`, `retrieved_at`, `confidence`, `evidence`. Es lo que evita que el sistema confunda "no encontrado" con "no tiene".

**SCORING** (`src/agent/pipelines/scoring.ts`): Fórmula determinística 0–100 que combina: validación (email/domain), evidencia FOUND (website, phone, instagram, linkedin), cross-source consistency (identity), research_state bonus. Se persiste como un `EvidenceRecord` INFERRED en el lead.

**INTELLIGENCE** (`src/agent/pipelines/intelligence.ts`): El LLM razona sobre el lead ya estructurado y produce un JSON con `summary`, `opportunity_size`, `outreach_angle`, `confidence`, `signals_used`. **No inventa datos**: si un campo está NOT_FOUND, el LLM dice "no determinable" para ese aspecto. El resultado se persiste como INFERRED.

**STORAGE** (`src/agent/storage/lead_intelligence.ts`): SQLite WAL separado. 5 tablas: `lead_intelligence_leads`, `lead_intelligence_evidence`, `lead_intelligence_sources`, `executions`, `dedup_matches`. Schema idempotente (`CREATE TABLE IF NOT EXISTS`).

**REPORT** (`src/agent/pipelines/report.ts`): Genera Markdown humano (tabla con `campo / valor / estado / confianza`, leyenda al final) + JSON compacto para consumo programático. Ordena leads por: research_state > FOUND count > validados count.

**CRM HOOKS** (`src/agent/pipelines/crm_albra_hooks.ts`): Adapter de webhook. No es un CRM — es un disparador de eventos (`lead.created`, `lead.scored`, `lead.intelligenced`, `lead.outreach_sent`, `execution.completed`) hacia un endpoint externo. Si el webhook falla, no bloquea el pipeline.

---

## 3. Flujo del pipeline

```
USER
  │
  ▼
TELEGRAM (text/voice)
  │
  ▼
AGENT LOOP (LLM)
  │
  │ tool_call: run_lead_pipeline({query, location, niche, ...})
  ▼
ORCHESTRATOR (runLeadPipeline)
  │
  ├─→ 1. DISCOVERY
  │     Apify (o MockDiscovery fallback) → CandidateLead[]
  │     Filter by min_followers (pipeline-level)
  │
  ├─→ 2. RESEARCH (PARALLEL batches)
  │     GoogleSearchResearch + Scrapling scraper →
  │     ResearchOutput {emails, phones, websites, socials, raw_text}
  │     → Research.ts construye Lead.evidence[] (FOUND/NOT_FOUND/INFERRED por campo)
  │     → research_state = "RESEARCHED"
  │
  ├─→ 3. VALIDATION (PARALLEL)
  │     RapidEmailVerifier.verifyEmail / verifyDomain / verifyUrl
  │     + cross-source identity check (email domain vs website domain)
  │     → Lead.validation{} (status + confidence por campo)
  │     → research_state = "VALIDATED"
  │
  ├─→ 4. EVIDENCE (built in RESEARCH — no stage separada)
  │     Cada campo lleva su EvidenceRecord desde RESEARCH
  │
  ├─→ 5. DEDUP (PARALLEL, batches de N/2 para DB safety)
  │     buildDedupSignature → findDedupMatch
  │       EXACT (email/website) → STRONG (instagram/phone/domain) → PROBABLE (name+location)
  │     Match → mergeLeads (preserva el más avanzado research_state, dedupe evidence por prioridad)
  │     No match → saveLead (INSERT)
  │     Audit: recordDedupMatch
  │
  ├─→ 6. SCORING (PARALLEL, pure computation)
  │     scoreLead(lead) → 0-100 + breakdown
  │     Persistido como INFERRED EvidenceRecord("lead_score")
  │
  ├─→ 7. INTELLIGENCE (PARALLEL, optional — si offer_description presente)
  │     LLM call: buildLLMInput(lead) → JSON {summary, opportunity_size, outreach_angle, confidence, signals_used}
  │     Persistido como INFERRED EvidenceRecord("llm_intelligence")
  │     Fallback determinístico si LLM no disponible
  │
  ├─→ 8. STORAGE (durante DEDUP y al final)
  │     saveExecution(trace) persiste el ExecutionTrace completo
  │
  ├─→ 9. REPORT
  │     generateReport → Markdown (TOP LEADS + leyenda) + JSON
  │
  └─→ 10. CRM-ALBRA hooks (optional)
        fireLeadCreated / fireLeadScored / fireLeadIntelligenced / fireExecutionCompleted
        (no blocking on failure)

Agent loop returns to LLM → LLM returns report to user
```

> Las etapas 3, 5, 6 y 7 corren en paralelo dentro de cada batch (P1.3). El tamaño de batch es `max_concurrency` (default 3) para research/validation/scoring/intelligence, y `floor(max_concurrency / 2)` para dedup+storage (DB writes).

---

## 4. Abstracción de Providers

Cuatro interfaces canónicas + dos de outreach:

```typescript
// ─── src/agent/providers/types.ts ────────────────────────

interface DiscoveryProvider {
  name: string;
  isConfigured(): Promise<boolean>;     // cheap env check
  discover(input: DiscoveryInput): Promise<ProviderResult<CandidateLead[]>>;
}

interface ResearchProvider {
  name: string;
  isConfigured(): Promise<boolean>;
  research(input: ResearchInput): Promise<ProviderResult<ResearchOutput>>;
}

interface VerificationProvider {
  name: string;
  isConfigured(): Promise<boolean>;
  verifyEmail(email: string): Promise<ProviderResult<EmailVerificationResult>>;
  verifyDomain(domain: string): Promise<ProviderResult<DomainVerificationResult>>;
  verifyUrl(url: string): Promise<ProviderResult<UrlVerificationResult>>;
}

interface ScrapingProvider {
  name: string;
  isConfigured(): Promise<boolean>;
  scrape(input: ScrapeInput): Promise<ProviderResult<ScrapeOutput>>;
}

// ─── src/agent/providers/outreach.ts ──────────────────────

interface EmailOutreachProvider {
  name: string;
  isConfigured(): Promise<boolean>;
  send(input: OutreachInput): Promise<ProviderResult<OutreachResult>>;
}

interface WhatsAppOutreachProvider {
  name: string;
  isConfigured(): Promise<boolean>;
  send(input: OutreachInput): Promise<ProviderResult<OutreachResult>>;
}
```

### Implementaciones actuales

| Interfaz | Implementación | Notas |
|----------|----------------|-------|
| `DiscoveryProvider` | `ApifyDiscoveryProvider` (Apify google-search-scraper) | Requiere `APIFY_TOKEN`. Query: `site:instagram.com + <query> + @gmail.com` |
| `DiscoveryProvider` | `MockDiscoveryProvider` | Fixture de 3 restaurantes veganos en Medellín. Para tests y demo. |
| `ResearchProvider` | `GoogleSearchResearchProvider` (Apify) | Requiere `APIFY_TOKEN`. Extrae emails/phones/websites/socials con regex. |
| `VerificationProvider` | `RapidEmailVerificationProvider` (fly.io) | Servicio público. Siempre `isConfigured() === true`. |
| `ScrapingProvider` | `ScraplingScrapingProvider` (Python bridge) | Requiere `.venv` con `scrapling`. **No evade CAPTCHAs ni Cloudflare.** |
| `EmailOutreachProvider` | `SendGridEmailProvider` | SendGrid v3 API. Requiere `SENDGRID_API_KEY` + `SENDGRID_FROM_EMAIL`. |
| `WhatsAppOutreachProvider` | `WhatsAppCloudProvider` | WhatsApp Cloud API v21.0. Requiere `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`. |
| Ambos outreach | `MockOutreachProvider` | Para tests / dry runs sin providers reales. |

### ProviderResult envelope

```typescript
interface ProviderResult<T> {
  ok: boolean;
  data?: T;            // presente si ok=true
  error?: ProviderError; // presente si ok=false
}
```

**Regla de oro**: un provider **nunca throws** al caller. Toda falla se empaqueta como `ProviderError` via `normalizeError()`. El orquestador nunca ve `Error`, `FetchError`, ni excepciones SDK-specific.

---

## 5. Taxonomía de errores (P0.10)

```typescript
type ErrorType =
  | "OK"
  | "TEMPORARY_FAILURE"   // retryable, backoff
  | "AUTH_FAILURE"         // no retry, skip provider
  | "RATE_LIMIT"           // retryable, backoff largo
  | "EMPTY_RESULT"         // no retry, no fallback (legitimate empty)
  | "INVALID_INPUT"        // no retry, caller bug
  | "TIMEOUT"              // retryable limited
  | "PROVIDER_UNAVAILABLE"; // try next provider
```

### Política de retry (regla en `shouldRetry`)

| ErrorType | Retryable | Fallback | Comportamiento |
|-----------|-----------|----------|----------------|
| `OK` | — | — | success path |
| `TEMPORARY_FAILURE` | ✅ | ✅ | backoff 1s × 2^(n-1), max 3 intentos |
| `AUTH_FAILURE` | ❌ | ✅ | skip provider, try next |
| `RATE_LIMIT` | ✅ | ✅ | backoff, max 3 intentos |
| `EMPTY_RESULT` | ❌ | ❌ | legitimate empty, no retry |
| `INVALID_INPUT` | ❌ | ❌ | caller bug, fix caller |
| `TIMEOUT` | ✅ | ✅ | limited retry |
| `PROVIDER_UNAVAILABLE` | ❌ | ✅ | skip, try next |

### `normalizeError()` heuristics

```typescript
function normalizeError(err: unknown, providerName?: string): ProviderError
```

- `fetch` Response con `status` → mapeo HTTP:
  - 401/403 → `AUTH_FAILURE`
  - 429 → `RATE_LIMIT`
  - 408/504 → `TIMEOUT`
  - 5xx → `PROVIDER_UNAVAILABLE`
  - 4xx (otros) → `INVALID_INPUT`
- Mensaje contiene "timeout"/"etimedout"/"aborted" → `TIMEOUT`
- "econnreset"/"econnrefused"/"enotfound" → `PROVIDER_UNAVAILABLE`
- "rate limit"/"too many requests"/"429" → `RATE_LIMIT`
- "unauthorized"/"forbidden"/"api key"/"token" → `AUTH_FAILURE`
- "not found" + "python" → `PROVIDER_UNAVAILABLE` (venv missing)
- "empty"/"no results"/"no leads" → `EMPTY_RESULT`
- fallback default → `TEMPORARY_FAILURE`

---

## 6. Motor de evidencia (P0.6)

```typescript
type ObservationStatus =
  | "FOUND"              // el valor fue observado en una fuente pública
  | "NOT_FOUND"          // se buscó, el valor no apareció
  | "CONFIRMED_ABSENT"   // múltiples fuentes confirman que no existe
  | "INFERRED";           // derivado por el sistema (no directamente observado)

type ConfidenceLevel = "high" | "medium" | "low" | "none";

interface EvidenceRecord<T = string> {
  field: string;             // "email" | "website" | "instagram" | ...
  value: T | null;
  status: ObservationStatus;
  source: string;            // "ApifyGoogleSearch", "Scrapling", ...
  retrieved_at: string;      // ISO 8601
  confidence: ConfidenceLevel;
  evidence: string;          // free-form supporting text (URLs, snippets, ...)
  inferred_from?: string[];  // for INFERRED values: reasoning chain
}
```

### Helpers

```typescript
found(field, value, source, evidence, confidence)        // FOUND
notFound(field, source, evidence="Searched, value did not appear")  // NOT_FOUND
confirmedAbsent(field, source, evidence)                // CONFIRMED_ABSENT
inferred(field, value, reason, inferred_from=[])        // INFERRED
```

### Labels humanos

```typescript
statusLabel("FOUND")              // "encontrado"
statusLabel("NOT_FOUND")          // "no encontrado"
statusLabel("CONFIRMED_ABSENT")   // "ausente confirmado"
statusLabel("INFERRED")            // "inferido"

confidenceLabel("high")            // "alta"
confidenceLabel("medium")         // "media"
confidenceLabel("low")             // "baja"
confidenceLabel("none")            // "ninguna"
```

---

## 7. Regla "no encontrado ≠ no tiene" (P0.6)

> **La regla de oro de AGENTE LEADS.**

Un valor `NOT_FOUND` significa: **buscamos, no apareció en las fuentes consultadas**. **No** significa que el lead no lo tenga. Solo `CONFIRMED_ABSENT` (múltiples fuentes confirmando ausencia) permite decir "no tiene X".

### Dónde se aplica

1. **`src/agent/pipelines/research.ts`** — Para cada campo del Lead, si no aparece en research+scraping, se crea `notFound(field, source, "Searched in research + scraping — value did not appear")`. Nunca se omite.

2. **`src/agent/pipelines/report.ts`** — El reporte Markdown muestra `no encontrado` para los `NOT_FOUND`. El código de validación de tests E2E comprueba que el reporte **NO** diga "no tiene website" / "no tiene email" / "no tiene linkedin".

3. **`src/agent/pipelines/intelligence.ts`** — El system prompt del LLM intelligence module incluye explícitamente:
   > "NEVER claim 'doesn't have X' if X is just NOT_FOUND — say 'X not found in available sources' instead."

4. **`src/agent/loop.ts`** — El system prompt del agente principal incluye:
   > "Distingue siempre entre 'no encontrado' y 'no tiene' — solo lo segundo requiere confirmación."

### Test que lo valida

`tests/e2e.test.ts` → subtest *"produces correct report with observed/validated/inferred distinction"*:

```typescript
assert.ok(result.report_text.includes("no encontrado"));
assert.ok(!result.report_text.toLowerCase().includes("no tiene website"));
assert.ok(!result.report_text.toLowerCase().includes("no tiene email"));
assert.ok(!result.report_text.toLowerCase().includes("no tiene linkedin"));
```

---

## 8. Lead Score (P1.1)

```typescript
// src/agent/pipelines/scoring.ts

function scoreLead(lead: Lead): LeadScore {
  // Score 0-100, clamped, deterministic.
}
```

### Fórmula

| Señal | Puntos | Razón |
|-------|--------|-------|
| Email validado + SMTP check (high confidence) | +20 | email_validation |
| Email validado (no SMTP check) | +15 | email_validation |
| Email invalid | -10 | email_validation |
| Domain valid | +15 | domain_validation |
| Website FOUND | +10 | website_found |
| Phone FOUND | +5 | phone_found |
| Instagram FOUND | +10 | instagram_found |
| LinkedIn FOUND | +10 | linkedin_found |
| Cross-source identity valid | +5 | identity_consistency |
| Cross-source identity conflict | -10 | identity_conflict |
| research_state: VALIDATED / STORED | +15 | research_state bonus |
| research_state: RESEARCHED | +10 | |
| research_state: DISCOVERED | +5 | |
| research_state: RESEARCHING | +2 | |
| research_state: FAILED | 0 | |

Máximo teórico: ~100. Se persiste como `EvidenceRecord` INFERRED con `field="lead_score"` (porque **es** una inferencia del sistema, no un hecho observado).

### Por qué NO es ML

El usuario explícitamente excluyó "sistemas de scoring excesivamente sofisticados". El scoring es:
- **Transparente** — el breakdown está en el `evidence.evidence` text.
- **Determinístico** — mismo lead → mismo score.
- **Testeable** — los tests saben exactamente qué signals esperar.

---

## 9. LLM Intelligence (P1.2)

```typescript
// src/agent/pipelines/intelligence.ts

interface LeadIntelligence {
  summary: string;            // 1-2 sentence factual description
  opportunity_size: "small" | "medium" | "large" | "unknown";
  outreach_angle: string;     // 1-sentence pitch suggestion
  confidence: "high" | "medium" | "low" | "none";
  signals_used: string[];     // fields used for reasoning (transparency)
}
```

### Cómo razona el LLM

El system prompt dice:

> "You are AGENTE LEADS' Lead Intelligence module. Your job is to reason about a lead's public information and produce actionable intelligence for sales."

Reglas críticas del prompt:

1. **NEVER invent facts not in the input.** Si no se sabe, "no determinable" o "unknown".
2. Distingue entre OBSERVED (FOUND) y NOT_FOUND (searched but didn't appear).
3. **NEVER claim "doesn't have X"** si X está NOT_FOUND — decir "X not found in available sources".
4. Sé CONSERVADOR con opportunity_size — solo "large" si múltiples señales fuertes.
5. Output ONLY JSON.

### Input del LLM

`buildLLMInput(lead, offerDescription)` construye un prompt estructurado con:
- Lead data (name, username, website, email, phone, location, sources, ...)
- Validation state (campo → status → confidence → notes)
- Evidence records (campo → value → status → confidence → source)
- Contexto opcional: offer_description del vendedor

### Output y fallback

- Si el LLM responde JSON válido → se parsea y se persiste como `EvidenceRecord INFERRED` con `field="llm_intelligence"`.
- Si el LLM falla (empty / parse error / timeout) → `makeFallbackIntelligence(lead)` produce una inteligencia mínima determinística a partir del count de FOUND signals.

### Por qué el LLM no inventa

Porque su **input** es siempre el Lead ya estructurado con `EvidenceRecord[]` etiquetados FOUND/NOT_FOUND/CONFIRMED_ABSENT/INFERRED. El LLM solo **razona** sobre lo que ya está etiquetado. No descubre datos nuevos.

---

## 10. Outreach pipeline (P2.4)

```typescript
// src/agent/pipelines/outreach.ts

async function runOutreach(input: OutreachInput_Pipeline): Promise<OutreachOutput>
```

### Flujo

```
1. Filtrar leads por min_score (default 50)
   - score < min_score → skipped (no LLM call wasted)

2. Determinar canal de outreach (ANTES del LLM — saves tokens)
   - lead.email + validation.email.status === "valid" → email
   - lead.phone (no validated email) → whatsapp
   - ni uno ni otro → skipped ("no_contact_channel")

3. Verificar que el provider del canal esté configurado
   - en dry_run=false sin provider → skipped ("{channel}_provider not configured")

4. Generar propuesta con LLM (GLM 5.3 Flash)
   - prompt con lead data + evidence + validation + offer_description
   - system prompt con reglas: 150-250 palabras, mention by name, CTA único
   - en dry_run, fallo es no-fatal (se reporta pero no se cae)

5. Si dry_run=true → devolver propuesta en el resultado (NO se envía)
   - status: "dry_run"

6. Si dry_run=false → enviar via provider real
   - SendGrid v3 (email) o WhatsApp Cloud API v21.0 (phone)
   - status: "sent" o "failed"

7. Fire CRM-ALBRA hook (si está configurado)
   - fireLeadOutreachSent(lead, channel, messageId)
   - no blocking on failure
```

### DRY RUN por defecto (safety default)

```typescript
const dryRun = input.dry_run !== false;  // default true
```

El system prompt del agente principal incluye:

> "Para outreach, SIEMPRE pregunta al usuario antes de pasar dry_run=false — no envíes propuestas sin confirmación."

### Selección de canal

| Condición | Canal | Provider |
|-----------|-------|----------|
| `lead.email` + `validation.email.status === "valid"` | email | SendGrid |
| `lead.phone` (sin validated email) | whatsapp | WhatsApp Cloud API |
| ni uno ni otro | skip | — |

### APIs oficiales — sin bots

El usuario fue explícito:

> "Cuando una fuente requiera una API oficial, utilizar su API correspondiente."
> "La arquitectura debe estar preparada para añadir posteriormente integraciones con email, WhatsApp, CRM y otras herramientas de ventas, siempre utilizando métodos autorizados."

**No hay**: DM bots, CAPTCHA bypass, fake accounts, scraping de WhatsApp Web, OAuth de Instagram.

---

## 11. Storage separation (P0.8)

### DB #1 — Conversations

**Archivo**: `src/database/sqlite.ts`
**Path**: `process.env.DB_PATH ?? "./data/agente-leads.db"`

**Tablas**:
- `conversations` (user_id, role, content, tool_name, tool_call_id, created_at)
- `memory_fragments` (user_id, key, value, updated_at)
- `users` (telegram_id, username, first_name, last_name, first_seen, last_active)
- `leads` (legacy — email, username, url, followers, status, source)

**Uso**: Agent loop reconstruye historial (`getRecentMessages(userId, 20)`). `/clear` borra filas de `conversations` del usuario. `/memory` lee `memory_fragments`.

### DB #2 — Lead intelligence

**Archivo**: `src/agent/storage/lead_intelligence.ts`
**Path**: `process.env.LEADS_DB_PATH ?? "./data/lead-intelligence.db"`

**Tablas**:
- `lead_intelligence_leads` (P0.1 canonical Lead)
- `lead_intelligence_evidence` (P0.6 per-field evidence)
- `lead_intelligence_sources` (per-provider raw payloads — reserved for future use)
- `executions` (P0.11 execution traces con todos los steps)
- `dedup_matches` (P0.7 audit log de matches EXACT/STRONG/PROBABLE)

**Características**:
- Lazy init via `getDb()` (mejor para tests que pueden resetear)
- `resetStorageForTests()` limpia rows sin cerrar la conexión (evita native crash de better-sqlite3)
- `process.on("beforeExit" + "exit")` cierra la DB limpiamente antes del GC
- `saveLead()` es upsert por `lead.id` — genera `lead_<ts>_<6-char>` si no hay id
- Reemplaza evidence en cada save (delete + bulk insert) — la tabla evidence siempre refleja el último estado
- `findDedupMatch()` cascade: EXACT (email/website) → STRONG (instagram/phone/domain) → PROBABLE (name+location NFD-stripped)

### Por qué separados

> *"Separa conceptualmente conversation memory de lead intelligence."* (P0.8)

- Conversaciones son volátiles y se resetean con `/clear`. Leads son持久ente y crece con cada pipeline run.
- Conversaciones son per-user. Leads son globales (multi-usuario accede a la misma DB de leads).
- Schema diferente: conversations tiene `role/tool_name/tool_call_id`. Leads tiene `evidence/validation_state/dedup_signature`.
- Backup: la DB de leads es la "crown jewels" — backup nightly. La de conversaciones puede regenerarse.

---

## 12. Tests organization

13 archivos de tests (12 capas + E2E), `--test-concurrency=1` para evitar el native crash de better-sqlite3 con workers paralelos.

| Archivo | Capa | Cobertura |
|---------|------|-----------|
| `tests/setup.ts` | helpers | `setupTestEnv()` + `cleanupTestEnv()` + re-export de core |
| `tests/lead.test.ts` | P0.1 | Lead canónico, buildDedupSignature, normalizeUrl/Name, extractHandle/SocialFromUrl (9 tests) |
| `tests/evidence.test.ts` | P0.6 | found/notFound/confirmedAbsent/inferred, statusLabel, confidenceLabel (8 tests) |
| `tests/errors.test.ts` | P0.10 | makeError, normalizeError HTTP heuristics, shouldRetry, backoffDelayMs (17 tests) |
| `tests/execution.test.ts` | P0.11 | ExecutionRecorder start/end/skip/finish, StepStatus (7 tests) |
| `tests/providers.test.ts` | P0.2 | 4 interfaces, ProviderResult envelope, ok/fail helpers (12 tests) |
| `tests/discovery.test.ts` | P0.3 | runDiscovery fallback, retry policy, EMPTY_RESULT no-fallback (6 tests) |
| `tests/research.test.ts` | P0.4 | runResearch, evidence per field, FOUND vs NOT_FOUND logic (8 tests) |
| `tests/validation.test.ts` | P0.5 | verifyEmail/Domain/Url, cross-source identity, confidence levels (7 tests) |
| `tests/dedup.test.ts` | P0.7 | EXACT/STRONG/PROBABLE/NO_MATCH, mergeLeads, pickMoreAdvanced, dedupEvidence (8 tests) |
| `tests/storage.test.ts` | P0.8 | saveLead upsert, getLeadById, getAllLeads, findDedupMatch cascade, recordDedupMatch, saveExecution, getExecution, checkStorageHealth (12 tests) |
| `tests/report.test.ts` | P0.12 | generateReport, sortLeadsByQuality, FIELD_LABELS, leyenda, "no encontrado" no se convierte en "no tiene" (12 tests) |
| `tests/scoring.test.ts` | P1.1 | scoreLead por señales, clamp 0-100, breakdown (var.) |
| `tests/intelligence.test.ts` | P1.2 | runIntelligence con fake LLM, fallback determinístico (var.) |
| `tests/quality.test.ts` | P1.4 | computeProviderMetrics, formatProviderMetrics (var.) |
| `tests/e2e.test.ts` | E2E | 6 subtests: pipeline completo, distinción observado/validado/inferido, empty result, idempotencia, tool registry, no-overclaim (6 subtests) |

### Tests E2E — el escenario "restaurantes veganos en Medellín"

```
Busca restaurantes veganos en Medellín
con más de 5.000 seguidores
y sin website encontrado.
```

Usa `MockDiscoveryProvider` (fixture de 3 restaurantes: Vegan Heaven 8200, La Raíz Vegana 6100, Green Bowl 3200) + fakes de research/verification/scraping. Verifica:
- Filtrado por min_followers deja 2 candidatos.
- Vegan Heaven tiene email validado → "encontrado" + "validado".
- La Raíz Vegana tiene website NOT_FOUND → reporte dice "no encontrado" (no "no tiene").
- Pipeline idempotente: correr dos veces no duplica leads (dedup mergea).

---

## 13. Extensiones futuras (P3+ — out of scope)

Lo siguiente **NO está implementado** y se declara explícitamente fuera del scope actual:

- ❌ **Transcripción de voz** (Whisper / OpenAI Speech-to-Text) — el handler de notas de voz descarga el .ogg pero la transcripción es un placeholder.
- ❌ **Dashboard web** — no hay UI más allá de Telegram. El sistema es conversacional.
- ❌ **CRM completo (ALBRA)** — solo se implementaron los webhook hooks (`crm_albra_hooks.ts`). El receptor del webhook es externo al repo.
- ❌ **Scoring con ML** — el Lead Score es determinístico y transparente por diseño. No hay modelo entrenado, no hay feature engineering, no hay feature store.
- ❌ **Más providers**: LinkedIn, Twitter/X, Facebook, TikTok, Pinterest. Las interfaces están listas (`DiscoveryProvider`), pero no hay implementaciones.
- ❌ **Vector search / embeddings** — no hay RAG, no hay pgvector, no hay semantic search.
- ❌ **Multi-tenant** — `ALLOWED_IDS` es una whitelist simple. No hay concept de organization/workspace.
- ❌ **Comandos `/help` y `/stats`** en Telegram — placeholders pendientes.
- ❌ **Webhook receptor (inbound)** — el bot solo emite webhooks. No recibe.
- ❌ **Job scheduler / cron** — no hay jobs recurrentes. Cada pipeline run es triggered por un mensaje del usuario.
- ❌ **Analytics dashboard** — `computeProviderMetrics` existe pero solo se persiste en `executions.steps`. No hay visualización.
- ❌ **CAPTCHA / Cloudflare bypass** — el sistema **no** evade CAPTCHAs (por diseño y por constraint del usuario). Si Scrapling recibe un 403/blocked, se normaliza a `TEMPORARY_FAILURE` y se reporta honestamente.

Para contribuir a alguna de estas extensiones, abrir issue primero para discutir el alcance.

---

## 14. Diagrama de paquetes y dependencias

```
src/index.ts
  └── src/bot/telegram.ts
        ├── src/database/sqlite.ts            (DB conversaciones)
        └── src/agent/loop.ts                 (Agent loop)
              ├── src/config/nvidia.ts         (LLM client)
              ├── src/database/sqlite.ts       (history)
              └── src/agent/registry.ts         (tool registry)
                    └── src/agent/tools/*
                          ├── run_lead_pipeline.ts
                          │     ├── src/agent/pipelines/orchestrator.ts
                          │     │     ├── discovery.ts
                          │     │     ├── research.ts
                          │     │     ├── validation.ts
                          │     │     ├── dedup.ts
                          │     │     ├── scoring.ts
                          │     │     ├── intelligence.ts
                          │     │     ├── report.ts
                          │     │     └── src/agent/storage/lead_intelligence.ts
                          │     └── src/agent/providers/registry.ts
                          │           ├── apify_discovery.ts
                          │           ├── google_search_research.ts
                          │           ├── scrapling_scraper.ts
                          │           │     └── utils/python_bridge.ts
                          │           ├── email_verifier_provider.ts
                          │           └── mock_discovery.ts
                          │
                          ├── run_outreach.ts
                          │     ├── src/agent/pipelines/outreach.ts
                          │     │     └── src/agent/pipelines/crm_albra_hooks.ts
                          │     └── src/agent/providers/outreach.ts (SendGrid + WhatsApp)
                          │
                          └── (legacy tools): get_current_time, scrape_instagram_leads,
                              enrich_lead_profile, verify_email, scrape_stealth, save_lead
```

**Ciclo de dependencias**: ningún archivo importa de `bot/` salvo `index.ts`. El agent layer es agnóstico a Telegram (se podría reemplazar por Discord/Slack reescribiendo solo `bot/`).

---

## 15. Decisiones de diseño notables

### 15.1. Por qué el LLM no ejecuta scrapers directamente

El LLM **decide qué hacer** (intención → tool_call), el orquestador **decide cómo hacerlo** (provider selection, retry policy, fallback). Esto permite:
- Reproducibilidad — mismo input → mismo output.
- Testeabilidad — los E2E usan fakes sin tocar el LLM.
- Seguridad — el LLM no puede invocar arbitrary URLs en nombre del usuario.
- Costo — el LLM no "desperdicia" tokens en llamadas HTTP; solo construye el intent.

### 15.2. Por qué GLM 5.3 Flash y no GPT-4o / Claude

- NVIDIA NIM ofrece el modelo gratis con rate limits generosos.
- GLM 5.3 Flash es un **reasoning model** — genera `reasoning_content` antes de `content`, lo que mejora la calidad del tool-calling.
- `max_tokens` bumped a 4096 para dejar espacio tanto para razonar como para responder.
- `temperature=0.5` (no 0) — permite algo de creatividad en las propuestas de outreach.

### 15.3. Por qué SQLite y no Postgres

- Es un bot de Telegram — no necesita concurrencia masiva.
- SQLite WAL permite reads concurrentes.
- Zero ops — no hay DB que mantener.
- Migrar a Postgres requeriría cambios mínimos (better-sqlite3 → pg) si la escala lo pidiera.

### 15.4. Por qué mejor-sqlite3 y no Prisma

- Synchronous API — más fácil de razonar en pipelines determinísticos.
- Performance — `Promise.all` sobre batches sigue siendo síncrono por debajo (mejor para CPU-bound scoring).
- Migrar a Postgres requeriría async en cada `prepare/run/get` — refactor significativo.

### 15.5. Por qué el sistema reporta "no encontrado" en vez de omitir el campo

Si un lead no tiene email, el reporte **debe decir** "no encontrado" en la columna email. Si se omite, el usuario no sabe si se buscó o no. La transparencia es más valiosa que la limpieza visual.

### 15.6. Por qué Outreach es DRY RUN por defecto

Las propuestas generadas por LLM son impredecibles. Un envío accidental a 50 leads con una propuesta con alucinaciones es un desastre reputacional. DRY RUN permite al usuario **revisar** las propuestas antes de enviar.

### 15.7. Por qué no usar tool_choice forzado

El LLM decide qué tool llamar (`tool_choice: "auto"`). Forzar `run_lead_pipeline` en cada mensaje arruinaría la flexibilidad conversacional. La confianza está en el system prompt, que instruye al LLM sobre cuándo usar cada tool.

---

Para más detalles:
- README.md — visión de usuario y quick start.
- DEPLOYMENT.md — guía de deployment producción (PM2 / systemd / Docker).
- `src/agent/pipelines/orchestrator.ts` — código comentado del orquestador.
- `tests/e2e.test.ts` — el escenario canónico del sistema.
