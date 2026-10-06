# Investigación de Mercado: APIs de Scraping para AGENTE LEADS
*Actualizado: Abril 2025*

---

## 🥇 OPCIÓN RECOMENDADA 1: APIFY (Usada actualmente en código)

**Web:** apify.com

### Casos de uso:
- Instagram Profile Scraper
- Google Search Scraper (ya implementado en AGENTE LEADS)
- TikTok Scraper
- LinkedIn Scraper (con limitaciones)

### Pricing (2025):

| Plan | Costo | Incluye |
|:-----|:------|:--------|
| **Free** | $0 | $5 en compute credits/mes (~500-1000 requests) |
| **Starter** | $49/mes | $49 en credits, 8 concurrent runs, priority support |
| **Scale** | $499/mes | Enterprise features, elite proxy, dedicated API |

Precios por actor:
- Instagram Profile Scraper: ~$2-5 por 1,000 perfiles
- Google Search Scraper: ~$1-3 por 1,000 búsquedas

### Pros:
✅ Plataforma madura (Netflix, Accenture, etc.)
✅ Marketplace con 1000+ scrapers pre-hechos
✅ SDKs en JS/Python
✅ 💚 Ya está implementado en AGENTE LEADS (cambio mínimo)

### Cons:
❌ Costo mensual si necesitas volumen
❌ Instagram cada vez más restrictivo (rate limits)

---

## 🥈 OPCIÓN 2: SCRAPINGBEE

**Web:** scrapingbee.com

### Casos de uso:
- Web scraping general
- JavaScript rendering (páginas dinámicas)
- Rotación de proxies

### Pricing (2025):

| Plan | Costo | Incluye |
|:-----|:------|:--------|
| **Free** | $0 | 100 API calls/mes |
| **Freelance** | $49/mes | 100K API calls, 20 concurrent, JS rendering |
| **Startup** | $99/mes | 500K API calls, priority proxy |

### Pros:
✅ $49/mes = más barato que Apify para scraping simple
✅ Muy bueno para sitios con JavaScript
✅ API simple (un solo endpoint HTTP)

### Cons:
❌ No marketplace de actores especializados
❌ Hay que construir el scraper manualmente para Instagram

---

## 💡 OPCIÓN 3: HUNTER.IO (para enriquecimiento de emails)

**Web:** hunter.io

### Especialidad:
- Buscar emails por dominio
- Verificación de emails
- Enriquecimiento de contactos

### Pricing (2025):

| Plan | Costo | Incluye |
|:-----|:------|:--------|
| **Free** | $0 | 25 búsquedas + 50 verificaciones/mes |
| **Starter** | $34/mes | 500 búsquedas, 1,000 verificaciones, API access |
| **Growth** | $104/mes | 2,500 búsquedas, 5,000 verificaciones |

### Pros:
✅ Especialistas en emails (lo que AGENTE LEADS necesita)
✅ API bien documentada
✅ Integración simple (REST API)

---

## 📊 COMPARATIVA RÁPIDA

| Plataforma | Costo | Enfoque | Dificultad |
|:-----------|:------|:--------|:-----------|
| Apify (Free) | $0-5/mes | Marketplace scrapers | ⭐ Fácil |
| Apify Starter | $49/mes | Marketplace scrapers | ⭐ Fácil |
| ScrapingBee | $49/mes | Web scraping general | ⭐⭐ Media |
| Hunter.io | $34/mes | Email enrichment | ⭐ Fácil |

---

## 🎯 RECOMENDACIÓN: Opción A (Arranque Gratuito)

**Componentes:**
- Apify Free ($5 credits/mes)
- Hunter.io Free (25 búsquedas + 50 verificaciones)
- **Costo total: $0/mes**

**Volumen estimado:**
- ~500-1000 Instagram profiles escaneables
- ~50 emails verificables
- Adecuado para testing y primeros clientes

**Duración:** 1-2 meses hasta tener revenue que justifique upgrade.

---

## 📝 PASOS PARA IMPLEMENTAR

1. [ ] Crear cuenta en Apify → copiar token
   - URL: apify.com/sign-up
   - Tokens: Console → Settings → API Tokens

2. [ ] Configurar `APIFY_TOKEN` en .env

3. [ ] Crear cuenta en Hunter.io → copiar API key
   - URL: hunter.io/sign-up
   - API key: Dashboard → API

4. [ ] Configurar `HUNTER_API_KEY` en .env

5. [ ] Actualizar `verify_email.ts` con Hunter.io

6. [ ] Probar: `npm run dev`

---

## 📈 PROYECCIÓN DE COSTOS (6 meses)

| Periodo | Apify | Hunter.io | Total | Notas |
|:--------|:------|:----------|:------|:------|
| Mes 1-2 | $0 | $0 | $0 | Testing con planes free |
| Mes 3 | $49 | $34 | $83 | Escala suave con revenue |
| Mes 4-6 | $49 | $104 | $153 | Volumen estable |

**ROI:** Si un cliente paga $1,000+, el costo ($153/mes) es viable.

---

*Research por Hermes V.5.0 | Market Intelligence Protocol*
