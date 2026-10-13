// ============================================================
// src/lib/leads/envelope.ts — P1 Contract 7: provider envelope
// {ok, data, error{code}} con taxonomía AUTH/UNAVAILABLE/RATE_LIMIT/
// EMPTY/TIMEOUT/INVALID_INPUT/UNKNOWN + metadatos de coste/llamadas.
// Patrón alineado con el bot raíz (core/errors.ts) — RADAR_DE_CLIENTES_PLAN.md contrato 7.
// ============================================================

export type ProviderErrorCode =
  | "AUTH" // credenciales ausentes o inválidas (401/403)
  | "UNAVAILABLE" // red / 5xx / DNS
  | "RATE_LIMIT" // 429 o cuota agotada
  | "TIMEOUT" // abort por timeout
  | "EMPTY" // 200 sin resultados → ok:true con data:[]
  | "INVALID_INPUT" // parámetros insuficientes o malformados
  | "UNKNOWN"; // no clasificable

export interface ProviderError {
  provider: string;
  code: ProviderErrorCode;
  message: string;
  httpStatus?: number;
  retryable: boolean;
}

export interface ProviderCallMeta {
  provider: string;
  /** Número de llamadas HTTP realizadas (incluye paginación). */
  calls: number;
  durationMs: number;
  /** Instante ISO-8601 de la respuesta. */
  fetchedAt: string;
}

export type ProviderResult<T> =
  | { ok: true; data: T; meta: ProviderCallMeta }
  | { ok: false; error: ProviderError; meta?: ProviderCallMeta };

/** Envuelve una respuesta exitosa. `data` vacío sigue siendo ok:true (el código EMPTY solo aplica al fallo esperado). */
export function providerOk<T>(data: T, meta: ProviderCallMeta): ProviderResult<T> {
  return { ok: true, data, meta };
}

/** Construye un fallo clasificado. `retryable` por defecto true para RATE_LIMIT/TIMEOUT/UNAVAILABLE. */
export function providerFail<T = unknown>(
  provider: string,
  code: ProviderErrorCode,
  message: string,
  opts: { httpStatus?: number; retryable?: boolean; meta?: ProviderCallMeta } = {}
): ProviderResult<T> {
  const retryable =
    opts.retryable ??
    (code === "RATE_LIMIT" || code === "TIMEOUT" || code === "UNAVAILABLE");
  const error: ProviderError = {
    provider,
    code,
    message,
    httpStatus: opts.httpStatus,
    retryable,
  };
  const result: ProviderResult<T> = { ok: false, error };
  if (opts.meta) result.meta = opts.meta;
  return result;
}

const HTTP_CODE_MAP: Record<number, ProviderErrorCode> = {
  400: "INVALID_INPUT",
  401: "AUTH",
  403: "AUTH",
  404: "UNAVAILABLE",
  422: "INVALID_INPUT",
  429: "RATE_LIMIT",
};

/** Clasifica un error HTTP según taxonomía del contrato 7. */
export function classifyHttpError(
  provider: string,
  status: number,
  body?: string
): ProviderError {
  const code =
    HTTP_CODE_MAP[status] ?? (status >= 500 ? "UNAVAILABLE" : "UNKNOWN");
  return {
    provider,
    code,
    message: `HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    httpStatus: status,
    retryable: code === "RATE_LIMIT" || code === "UNAVAILABLE",
  };
}

/** Metadatos de llamada listos para adjuntar a un resultado. */
export function providerMeta(
  provider: string,
  calls: number,
  durationMs: number
): ProviderCallMeta {
  return { provider, calls, durationMs, fetchedAt: new Date().toISOString() };
}

/** Type-guard para errores de proveedor lanzados como excepción. */
export function isProviderError(e: unknown): e is ProviderError {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    "provider" in e &&
    typeof (e as ProviderError).code === "string"
  );
}
