# 🛠️ 02 — Pipelines y Herramientas del Agente

## 1. Inventario de Herramientas Registradas

Las herramientas están centralizadas en `src/agent/registry.ts` y expuestas al modelo:

| Herramienta | Archivo | Función Principal |
| :--- | :--- | :--- |
| `scrape_instagram_leads` | `tools/scrape_instagram_leads.ts` | Busca perfiles de Instagram con emails públicos en Apify según nicho y ubicación. |
| `scrape_stealth` | `tools/scrape_stealth.ts` | Scraping de alta resiliencia anti-bloqueo para fuentes web complejas. |
| `verify_email` | `tools/verify_email.ts` | Valida sintaxis, existencia real de buzón y registros MX del dominio. |
| `enrich_lead_profile` | `tools/enrich_lead_profile.ts` | Si falta email, rastrea Google en busca de LinkedIn, web oficial o contacto alternativo. |
| `read_document` | `tools/read_document.ts` | Lee y extrae texto limpio de archivos **PDF** y **Word (.docx)** locales o remotos. |
| `save_lead` | `tools/save_lead.ts` | Deduplica y guarda el lead en SQLite / Airtable actualizando fechas si ya existía. |
| `run_lead_pipeline` | `tools/run_lead_pipeline.ts` | Ejecuta el ciclo completo de prospección autónoma por lotes. |
| `run_outreach` | `tools/run_outreach.ts` | Dispara el envío de mensajes comerciales bajo control de idempotencia. |

---

## 2. Detalle de Herramientas Clave

### A. `read_document.ts` (Lectura de PDF y DOCX)
Permite al agente analizar contratos, catálogos, briefs o documentación que envíe un cliente:
- **Detección por Magic Bytes**: Comprueba `%PDF` o encabezados PK zip de Word antes de parsear.
- **Límites de Seguridad**: Rechaza archivos de más de 15 MB y corta el texto extraído a 12,000 caracteres con bandera `truncated: true` para no desbordar el contexto del modelo.
- **Protección de Red**: Aplica validación SSRF contra URLs privadas antes de descargar.

### B. `scrape_instagram_leads.ts` & `enrich_lead_profile.ts`
- Consulta la API de Apify (`google-search-scraper`) para extraer menciones de perfiles de Instagram vinculadas a correos `@gmail.com` u otros dominios en un nicho específico.
- Si el perfil carece de correo visible pero tiene potencial comercial alto, `enrich_lead_profile` busca páginas de contacto y perfiles de LinkedIn asociados.

### C. `save_lead.ts` (Upsert y Deduplicación Local)
- Consulta la tabla `leads` en SQLite antes de insertar.
- Si el correo ya existe, ejecuta una actualización de `updated_at` y campos complementarios.
- Si es nuevo, lo almacena con su fuente y estado de validación.

---

## 3. Pipelines de Inteligencia (`src/agent/pipelines/`)

1. **`discovery.ts`**: Descubrimiento y recopilación inicial de candidatos.
2. **`validation.ts`**: Verificación de validez de emails y datos de contacto.
3. **`intelligence.ts`**: Análisis de señales y generación de contexto personalizado para cada lead.
4. **`outreach.ts`**: Gestión de contacto con control estricto de duplicidad mediante `makeIdempotencyKey`.
5. **`report.ts`**: Formateo estructurado de métricas para entrega directa por Telegram.
