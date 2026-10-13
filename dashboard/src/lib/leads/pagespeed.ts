// ============================================================
// src/lib/leads/pagespeed.ts
// Auditoría PageSpeed Insights v5 — Fase P2 Radar de Clientes.
//
// CONTRATO 5 del plan (RADAR_DE_CLIENTES_PLAN.md):
//   {url, strategy, scores{performance, seo, accessibility,
//   bestPractices}, auditedAt, status}
// con estados explícitos OK | UNREACHABLE | TIMEOUT | INVALID_URL.
//
// CUOTA KEYLESS: PSI es gratuito y funciona SIN API key (cuota baja
// por IP, ~unas pocas auditorías por minuto — suficiente para uso
// on-demand del CRM). La API key es OPCIONAL y aumentaría la cuota;
// vendrá de Integration.pageSpeedApiKey (otro agente la añade a
// Prisma en paralelo — este módulo NO toca el schema).
//
// SEGURIDAD: por diseño de PSI la key viaja como query param en la
// PETICIÓN y JAMÁS se refleja en el resultado, en los errores ni en
// logs (además se redacta de cualquier texto de error por defensa
// en profundidad).
//
// PATRÓN P1 (envelope): la función NUNCA lanza; todo fallo se
// devuelve como PageSpeedResult con status explícito y error legible
// (sin key). `parseScores` y `normalizeTargetUrl` son funciones puras
// exportadas para testeo directo.
// ============================================================

/** Estrategia de auditoría PSI. Default "mobile". */
export type PageSpeedStrategy = "mobile" | "desktop";

/** Estados explícitos del contrato 5 (sin excepciones: siempre hay estado). */
export type PageSpeedStatus = "OK" | "UNREACHABLE" | "TIMEOUT" | "INVALID_URL";

/** Scores Lighthouse 0-100. null = la categoría no vino auditable. */
export interface PageSpeedScores {
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  bestPractices: number | null;
}

/** Resultado de una auditoría PageSpeed (contrato 5 + trazabilidad). */
export interface PageSpeedResult {
  /** URL evaluada (normalizada = recortada; la que se auditó). */
  url: string;
  strategy: PageSpeedStrategy;
  scores: PageSpeedScores;
  /** ISO-8601: instante de cierre de la auditoría (éxito o fallo). */
  auditedAt: string;
  status: PageSpeedStatus;
  /** Detalle legible si status != OK — SIN la key jamás. */
  error?: string;
  /** Trazabilidad: se usó API key (true/false) — nunca la key en sí. */
  keyUsed: boolean;
  /** Duración de la llamada HTTP (ms). Ausente si no hubo llamada. */
  durationMs?: number;
}

/** Endpoint oficial PageSpeed Insights v5. La key (opcional) va por query param. */
const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/**
 * Timeout por defecto en ms. PSI es lento (corre Lighthouse completo,
 * 10-30s típicos), por eso el default es generoso: 25s.
 */
export const PSI_DEFAULT_TIMEOUT_MS = 25_000;

/** Categorías Lighthouse (PSI v5) → claves del contrato 5. */
const SCORE_CATEGORIES: ReadonlyArray<{
  key: keyof PageSpeedScores;
  category: string;
}> = [
  { key: "performance", category: "performance" },
  { key: "seo", category: "seo" },
  { key: "accessibility", category: "accessibility" },
  { key: "bestPractices", category: "best-practices" },
];

const EMPTY_SCORES: PageSpeedScores = {
  performance: null,
  seo: null,
  accessibility: null,
  bestPractices: null,
};

// ── Shapes mínimos de la respuesta PSI v5 (solo lo que se consume) ──

interface PsiApiError {
  message?: unknown;
}

interface PsiResponseBody {
  error?: PsiApiError;
  lighthouseResult?: unknown;
}

/**
 * Valida y normaliza la URL objetivo SIN tocar la red: trim + verificación
 * estricta con `new URL()` (protocolo http/https y hostname no vacío).
 * NO inventa scheme: "www.example.com" (sin scheme) es inválida por diseño
 * del contrato 5 (→ INVALID_URL). Devuelve la URL recortada o null si
 * es inválida.
 */
export function normalizeTargetUrl(url: string): string | null {
  const trimmed = typeof url === "string" ? url.trim() : "";
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  return trimmed;
}

/** Score Lighthouse 0..1 (o null) → entero 0..100 (clamp defensivo) o null. */
function scoreToPercent(score: unknown): number | null {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return Math.min(100, Math.max(0, Math.round(score * 100)));
}

/** Lee `categories[name].score` de forma defensiva (shapes arbitrarios). */
function categoryScore(categories: unknown, name: string): number | null {
  if (typeof categories !== "object" || categories === null) return null;
  const cat = (categories as Record<string, unknown>)[name];
  if (typeof cat !== "object" || cat === null) return null;
  return scoreToPercent((cat as Record<string, unknown>).score);
}

/**
 * Función PURA: mapea `lighthouseResult.categories` (PSI v5) al contrato 5.
 * Cada score viene 0..1 (puede venir null) → Math.round(score*100) o null.
 * Categorías ausentes o extra desconocidas → null / ignoradas.
 */
export function parseScores(lighthouse: unknown): PageSpeedScores {
  const categories =
    typeof lighthouse === "object" && lighthouse !== null
      ? (lighthouse as { categories?: unknown }).categories
      : undefined;
  const scores: PageSpeedScores = { ...EMPTY_SCORES };
  for (const { key, category } of SCORE_CATEGORIES) {
    scores[key] = categoryScore(categories, category);
  }
  return scores;
}

/** Elimina cualquier aparición de la key de un texto (defensa en profundidad). */
function redactSecret(text: string, apiKey?: string | null): string {
  if (!apiKey || !text) return text;
  return text.split(apiKey).join("[REDACTED]");
}

/** Detecta errores de abort (DOMException AbortError / TimeoutError). */
function isAbortError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/** Resultado de fallo con scores vacíos (los fallos no traen scores parciales). */
function failResult(
  url: string,
  strategy: PageSpeedStrategy,
  keyUsed: boolean,
  status: Exclude<PageSpeedStatus, "OK">,
  error: string,
  durationMs?: number
): PageSpeedResult {
  const result: PageSpeedResult = {
    url,
    strategy,
    scores: { ...EMPTY_SCORES },
    auditedAt: new Date().toISOString(),
    status,
    keyUsed,
  };
  if (error) result.error = error;
  if (typeof durationMs === "number") result.durationMs = durationMs;
  return result;
}

/**
 * Audita una URL con PageSpeed Insights v5. NUNCA lanza: devuelve
 * siempre un PageSpeedResult con status explícito del contrato 5.
 *
 * Clasificación:
 * - INVALID_URL: validación previa sin red (http/https + hostname; no
 *   se inventa scheme).
 * - TIMEOUT: abort del AbortController (default 25000ms, inyectable).
 * - UNREACHABLE: rechazo del fetch (red/DNS), !res.ok ("HTTP {status}" +
 *   extracto del body ≤200 chars), 200 con `error.message` embebido
 *   (análisis Lighthouse fallido del sitio objetivo) o 200 sin
 *   `lighthouseResult.categories`.
 * - OK: 200 con categorías Lighthouse → scores 0-100.
 *
 * @param url     URL objetivo (se recorta; NO se le inventa scheme).
 * @param opts.strategy  "mobile" (default) | "desktop".
 * @param opts.apiKey    API key opcional (viaja SOLO por query param, requisito
 *                       de PSI; jamás aparece en el resultado ni en errores).
 * @param opts.timeoutMs Timeout en ms (default 25000 — PSI es lento).
 */
export async function auditPageSpeed(
  url: string,
  opts: {
    strategy?: PageSpeedStrategy;
    apiKey?: string | null;
    timeoutMs?: number;
  } = {}
): Promise<PageSpeedResult> {
  const strategy: PageSpeedStrategy =
    opts.strategy === "desktop" ? "desktop" : "mobile";
  const keyUsed = Boolean(opts.apiKey);

  // 1) Validación previa SIN red → INVALID_URL explícito (contrato 5).
  const normalized = normalizeTargetUrl(url);
  if (!normalized) {
    const received = typeof url === "string" ? url.trim() : "";
    return failResult(
      received,
      strategy,
      keyUsed,
      "INVALID_URL",
      redactSecret(
        `URL inválida para PageSpeed: se requiere http/https con hostname (recibido: "${received}")`,
        opts.apiKey
      )
      // Sin durationMs: no hubo llamada.
    );
  }

  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? PSI_DEFAULT_TIMEOUT_MS;

  // 2) Petición GET. La key va SOLO como query param (así lo exige PSI);
  //    encodeURIComponent evita romper la query si tuviera caracteres especiales.
  const endpoint =
    `${PSI_ENDPOINT}?url=${encodeURIComponent(normalized)}&strategy=${strategy}` +
    (opts.apiKey ? `&key=${encodeURIComponent(opts.apiKey)}` : "");

  // 3) Timeout con AbortController dedicado.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(endpoint, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const durationMs = Date.now() - startedAt;
    if (isAbortError(err)) {
      return failResult(
        normalized,
        strategy,
        keyUsed,
        "TIMEOUT",
        `PageSpeed no respondió en ${timeoutMs}ms (timeout del análisis)`,
        durationMs
      );
    }
    // Red/DNS caídos u otro rechazo del fetch.
    const detail = err instanceof Error ? err.message : String(err);
    return failResult(
      normalized,
      strategy,
      keyUsed,
      "UNREACHABLE",
      redactSecret(`Error de red contactando PageSpeed: ${detail}`, opts.apiKey),
      durationMs
    );
  }
  clearTimeout(timer);
  const durationMs = Date.now() - startedAt;

  // 4) Error HTTP: "HTTP {status}" + extracto del body (≤200 chars, sin key).
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    const excerpt = redactSecret(bodyText.slice(0, 200), opts.apiKey);
    return failResult(
      normalized,
      strategy,
      keyUsed,
      "UNREACHABLE",
      `HTTP ${res.status}${excerpt ? `: ${excerpt}` : ""}`,
      durationMs
    );
  }

  // 5) 200 pero body no parseable como JSON.
  let data: PsiResponseBody;
  try {
    data = (await res.json()) as PsiResponseBody;
  } catch {
    return failResult(
      normalized,
      strategy,
      keyUsed,
      "UNREACHABLE",
      "PageSpeed devolvió una respuesta 200 no parseable como JSON",
      durationMs
    );
  }

  // 6) Análisis fallido: PSI responde 200 con `error.message` embebido
  //    (típico "Lighthouse returned error: ..."). Es un fallo del sitio
  //    objetivo o del análisis → el estado explícito lo documenta.
  if (typeof data.error?.message === "string" && data.error.message) {
    return failResult(
      normalized,
      strategy,
      keyUsed,
      "UNREACHABLE",
      redactSecret(data.error.message, opts.apiKey),
      durationMs
    );
  }

  // 7) 200 sin `lighthouseResult.categories` → no auditable.
  const lighthouse = data.lighthouseResult;
  const categories =
    typeof lighthouse === "object" && lighthouse !== null
      ? (lighthouse as { categories?: unknown }).categories
      : undefined;
  if (typeof categories !== "object" || categories === null) {
    return failResult(
      normalized,
      strategy,
      keyUsed,
      "UNREACHABLE",
      "Respuesta 200 sin lighthouseResult.categories (análisis no disponible)",
      durationMs
    );
  }

  // 8) Éxito: mapeo al contrato 5.
  return {
    url: normalized,
    strategy,
    scores: parseScores(lighthouse),
    auditedAt: new Date().toISOString(),
    status: "OK",
    keyUsed,
    durationMs,
  };
}
