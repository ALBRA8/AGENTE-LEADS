# MIGRATION ANALYSIS — AGENTE-LEADS → ARNÉS

## STACK IDENTIFICADO
- **Lenguaje**: TypeScript ESM (Node.js + tsx)
- **Framework**: grammy (Telegram bot) — NO es Next.js
- **DB**: better-sqlite3 (sin ORM)
- **LLM**: NVIDIA NIM (GLM 5.3 Flash) via OpenAI SDK
- **Python**: scrapling (scraping) via child_process execFile

## ARCHIVOS DEL AGENTE ENCARNADO (I = REFACTOR)

| Archivo | LIPO | Qué tiene | Destino |
|---------|------|-----------|---------|
| `src/config/nvidia.ts` | I | Cliente NVIDIA NIM (OpenAI SDK) + retry | → Bridge (NvidiaNimBridge) |
| `src/agent/loop.ts` | I | Agent loop con tool calling + system prompt | → Skill (AgentLoopSkill) + Knowledge (system prompt) |
| `src/agent/pipelines/intelligence.ts` | I | LLM reasoning sobre leads + SYSTEM_PROMPT | → Skill (IntelligenceSkill) + Knowledge (prompt) |
| `src/agent/pipelines/outreach.ts` | I | Generación de propuestas con LLM + prompt | → Skill (OutreachSkill) + Knowledge (prompt) |
| `src/agent/utils/python_bridge.ts` | I | execFile para scrapling | → Bridge (PythonBridge) |

## CONOCIMIENTO DEL DOMINIO (L = KEEP → KnowledgeRegistry)

| Archivo | Qué contiene | Categoría Knowledge |
|---------|-------------|---------------------|
| `src/agent/loop.ts` | System prompt del agente (qué tools, reglas) | agent-prompts |
| `src/agent/pipelines/intelligence.ts` | SYSTEM_PROMPT para LLM reasoning | agent-prompts |
| `src/agent/pipelines/outreach.ts` | SYSTEM_PROMPT para propuesta generation | agent-prompts |
| `src/agent/providers/mock_discovery.ts` | Datos demo (clínicas estética Medellín) | demo-data |
| `src/agent/providers/apify_discovery.ts` | Categorías OSM + queries Instagram | source-config |
| `src/agent/providers/overpass_discovery.ts` | Tag map (restaurant→amenity=restaurant, etc.) | source-config |
| `src/agent/pipelines/scoring.ts` | Pesos del Lead Score (20, 15, 10, 5, -10) | scoring-rules |
| `src/agent/pipelines/report.ts` | Labels de campos + leyenda | report-config |
| `src/agent/pipelines/dedup.ts` | Pesos de match (EXACT/STRONG/PROBABLE) | dedup-rules |

## ARCHIVOS A PRESERVAR (O = ORGANIZE, sin cambios)

| Archivo | Razón |
|---------|-------|
| `src/agent/core/*.ts` | Tipos canónicos (Lead, Evidence, Errors, Execution) — no cambian |
| `src/agent/providers/types.ts` | Interfaces de providers — no cambian |
| `src/agent/providers/*.ts` (impls) | Implementaciones de providers — no cambian |
| `src/agent/pipelines/discovery.ts` | Pipeline determinístico — no cambia |
| `src/agent/pipelines/research.ts` | Pipeline — no cambia |
| `src/agent/pipelines/validation.ts` | Pipeline — no cambia |
| `src/agent/pipelines/dedup.ts` | Pipeline — no cambia |
| `src/agent/pipelines/scoring.ts` | Pipeline — no cambia (solo pesos → Knowledge) |
| `src/agent/pipelines/report.ts` | Pipeline — no cambia |
| `src/agent/pipelines/quality.ts` | Métricas — no cambia |
| `src/agent/storage/lead_intelligence.ts` | Storage — no cambia |
| `src/agent/tools/*.ts` | Tools (run_lead_pipeline, run_outreach, legacy) — se reescriben para usar el harness |
| `src/bot/telegram.ts` | Bot — se reescribe para usar el adapter |
| `src/bot/telegram_helpers.ts` | Helpers UI — no cambia |
| `src/agent/health.ts` | Health check — no cambia |
| `src/agent/core/ssrf_guard.ts` | SSRF guard — no cambia |
| `tests/*.ts` | Tests — no cambian (testean pipelines, no el agente) |

## ARCHIVOS A ELIMINAR (P = DELETE)
Ninguno por ahora — el LIPO refactor extrae, no elimina. Los archivos originales se mantienen hasta que el harness esté validado.

## MAPA DE DEPENDENCIAS
```
src/config/nvidia.ts ← loop.ts, intelligence.ts, outreach.ts
src/agent/loop.ts ← bot/telegram.ts, index.ts
src/agent/pipelines/intelligence.ts ← orchestrator.ts
src/agent/pipelines/outreach.ts ← tools/run_outreach.ts
src/agent/utils/python_bridge.ts ← tools/scrape_stealth.ts, providers/scrapling_scraper.ts
```

## ACLOPAMIENTO OCULTO
- `.env` tiene NVIDIA_API_KEY (usado por nvidia.ts en import time)
- loop.ts usa nvidiaNIMClient directamente (no via bridge)
- intelligence.ts importa nvidiaNIMClient directamente
- outreach.ts importa nvidiaNIMClient directamente
