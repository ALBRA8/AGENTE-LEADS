# 🎯 CONTEXTO LEADS — AGENTE LEADS

> **Documentación Central de Arquitectura, Pipelines y Capacidades Autónomas**  
> Proyecto: `AGENTE LEADS`  
> Última sincronización: Noviembre 2026

---

## 📌 1. ¿Qué es AGENTE LEADS?

**AGENTE LEADS** es un sistema agéntico autónomo de prospección, enriquecimiento, validación de señales, cierre comercial y deduplicación de prospectos B2B/B2C de nivel empresarial.

A diferencia de un scraper convencional o un simple bot de chat, AGENTE LEADS opera como un **híbrido orquestador-agente**:
- **Cerebro LLM**: Conectado vía **NVIDIA NIM** (Kimi K2.5 / GLM 5.3 Flash / Llama 3.3 70B Instruct).
- **Interfaz Conversacional**: Bot de Telegram con Long Polling (framework **grammY**), seguro y con whitelist de usuarios permitidos.
- **Pipelines Autónomos**: Flujos modulares capaces de ejecutar prospección, validación profunda, deduplicación multicriterio, lectura documental multimodal y outreach con idempotencia.
- **Doble Persistencia SQLite (WAL)**:
  - `data/agente-leads.db`: Sesiones, mensajes de Telegram y memoria de usuario.
  - `data/lead-intelligence.db`: Grafos de inteligencia, señales de evidencia, registros de leads, ofertas JVZoo y auditoría.

---

## 🏗️ 2. Mapa de Documentación

| Archivo | Propósito |
| :--- | :--- |
| [01-ARQUITECTURA-GENERAL.md](file:///d:/PROYECTOS/AGENTES%20CON%20IA/AGENTE%20LEADS/CONTEXTO%20LEADS/01-ARQUITECTURA-GENERAL.md) | Diagrama de flujo, componentes del core, bases de datos y seguridad. |
| [02-PIPELINES-Y-HERRAMIENTAS.md](file:///d:/PROYECTOS/AGENTES%20CON%20IA/AGENTE%20LEADS/CONTEXTO%20LEADS/02-PIPELINES-Y-HERRAMIENTAS.md) | Detalle de las tools, scraping, deduplicación, lectura de documentos y enriquecimiento. |
| [03-DEDUPLICACION-Y-CALIDAD.md](file:///d:/PROYECTOS/AGENTES%20CON%20IA/AGENTE%20LEADS/CONTEXTO%20LEADS/03-DEDUPLICACION-Y-CALIDAD.md) | Algoritmo de señales compuestas, resolución de conflictos y calidad de proveedores. |
| [04-GUIAS-DE-DESPLIEGUE-Y-OPERACION.md](file:///d:/PROYECTOS/AGENTES%20CON%20IA/AGENTE%20LEADS/CONTEXTO%20LEADS/04-GUIAS-DE-DESPLIEGUE-Y-OPERACION.md) | Comandos de arranque, lanzadores de Windows (`.bat`), variables `.env` y troubleshooting. |

---

## ⚡ 3. Resumen Ejecutivo de Capacidades

1. **Scraping y Descubrimiento**:
   - Integración directa con **Apify** (Google Search Scraper para Instagram y web).
   - Extractor sigiloso `scrape_stealth` con emulación anti-detección.
2. **Lectura Multimodal de Documentos**:
   - Tool `read_document`: Capaz de leer archivos PDF y Word (`.docx`) por URL o ruta local con validación de magic bytes y mitigación SSRF.
3. **Deduplicación Inteligente**:
   - Fusión basada en señales ponderadas (`EXACT`, `STRONG`, `PROBABLE`) para evitar duplicidad sin fusionar por error empresas distintas con nombres similares.
4. **Outreach con Idempotencia**:
   - Pipelines de contacto vía email/WhatsApp con control estricto de hashes de idempotencia persistidos.
5. **Monitoreo y Métricas de Proveedores**:
   - Sistema `quality.ts` que monitoriza la tasa de éxito de APIs externas y activa degradación o respaldo si un proveedor falla.
