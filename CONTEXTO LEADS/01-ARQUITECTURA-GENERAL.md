# 🏛️ 01 — Arquitectura General de AGENTE LEADS

## 1. Diagrama de Flujo del Sistema

```mermaid
flowchart TD
    User([👤 Usuario / Operador]) <-->|Telegram grammY / Whitelist| TG[Bot Interface: src/bot/telegram.ts]
    TG <--> AgentLoop[Agent Loop: src/agent/loop.ts]
    
    subgraph Core ["🧠 Motor de Razonamiento y Herramientas"]
        AgentLoop <--> LLM[NVIDIA NIM: Kimi K2.5 / GLM / Llama 3.3]
        AgentLoop --> Registry[Tool Registry: src/agent/registry.ts]
        Registry --> Contracts[Contratos §17 & SSRF Guard]
    end

    subgraph Tools ["🛠️ Herramientas Ejecutables"]
        Contracts --> ScrapeInsta[scrape_instagram_leads]
        Contracts --> ScrapeStealth[scrape_stealth]
        Contracts --> VerifyEmail[verify_email]
        Contracts --> Enrich[enrich_lead_profile]
        Contracts --> ReadDoc[read_document: PDF / DOCX]
        Contracts --> SaveLead[save_lead: Upsert + Dedup]
    end

    subgraph Pipelines ["⚙️ Pipelines de Inteligencia"]
        Registry --> PipeOrch[orchestrator.ts]
        PipeOrch --> PipeDedup[dedup.ts: Señales Compuestas]
        PipeOrch --> PipeQuality[quality.ts: Salud de Proveedores]
        PipeOrch --> PipeOutreach[outreach.ts: Idempotencia §25]
    end

    subgraph Storage ["💾 Persistencia SQLite (WAL Mode)"]
        AgentLoop --> DBConv[(agente-leads.db: Sesiones y Memoria)]
        Pipelines --> DBIntel[(lead-intelligence.db: Leads, Señales, Auditoría)]
    end
```

---

## 2. Capas Principales del Sistema

### A. Capa de Interfaz y Seguridad (`src/bot/telegram.ts`)
- Utiliza **grammY** con Long Polling. No requiere puertos abiertos ni certificados SSL.
- **Middleware de Whitelist**: Valida `ALLOWED_IDS` contra los IDs numéricos autorizados en `.env`. Cualquier usuario no autorizado es bloqueado de inmediato.
- Comandos nativos:
  - `/start`: Bienvenida y presentación del rol.
  - `/clear`: Reinicio de contexto conversacional en la base de datos.
  - `/memory`: Inspección de recuerdos clave retenidos sobre el usuario.

### B. Capa del Bucle Agéntico (`src/agent/loop.ts`)
- Reconstruye el contexto del historial reciente desde SQLite.
- Ejecución paralela de herramientas (`Promise.all`) cuando el LLM emite múltiples llamadas simultáneas, reduciendo la latencia hasta en un 90%.
- Prompt del sistema con directivas de **Self-Healing**:
  - Normalización de correos (`[at]` $\rightarrow$ `@`).
  - Reformulación automática de búsquedas vacías con sinónimos.
  - Generación de reportes estructurados para Telegram.

### C. Capa de Contratos y Auditoría (`src/agent/tools/contracts.ts`)
- Cada tool define sus permisos (`READ`, `WRITE`, `NETWORK_OUTBOUND`), nivel de riesgo (`LOW`, `MEDIUM`, `HIGH`) y tiempo límite de ejecución.
- Incluye **SSRF Guard**: Previene peticiones maliciosas hacia redes privadas (`127.0.0.1`, `10.0.0.0/8`, metadata cloud, etc.) cuando se procesan URLs externas.
- Registro de auditoría persistido tras cada ejecución de herramienta.
