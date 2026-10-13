// ============================================================
// src/lib/leads/google-places-adapter.ts
// Google Places API (New) official adapter — P1 contrato 1 completo:
// fieldMask ampliado (placeId/coords/rating/businessStatus), keywords
// en textQuery, paginación nextPageToken (máx. 3 páginas ≈60 resultados),
// timeout por llamada (AbortController) y clasificación de errores
// mediante envelope {ok, data, error{code}} (contrato 7).
// NUNCA lanza: todo fallo se devuelve clasificado en el envelope.
// La API key viaja SOLO por header (nunca en URLs ni logs).
// ============================================================

import type { LeadSourceAdapter, RawProspect, SearchInput } from "./types";
import {
  classifyHttpError,
  providerFail,
  providerMeta,
  providerOk,
  type ProviderCallMeta,
  type ProviderResult,
} from "./envelope";

/** Endpoint oficial Places API (New) — Text Search. La key va por header. */
const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

/** Identificador del proveedor para el envelope (NO es el name del adapter). */
const PROVIDER = "google_places";

/** Máximo de páginas por búsqueda (cada página ≈20 resultados → ≈60). */
const MAX_PAGES = 3;

/** Timeout por defecto por llamada HTTP (ms). Inyectable vía constructor. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** FieldMask P1: Places completo + placeId/coords/rating/businessStatus. */
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.websiteUri",
  "places.internationalPhoneNumber",
  "places.googleMapsUri",
  "places.primaryTypeDisplayName",
  "places.editorialSummary",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
].join(",");

// ── Tipos mínimos de la respuesta Text Search (New) ──────────

interface PlacesPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  internationalPhoneNumber?: string;
  googleMapsUri?: string;
  primaryTypeDisplayName?: { text?: string };
  editorialSummary?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
}

interface PlacesSearchResponse {
  places?: PlacesPlace[];
  nextPageToken?: string;
}

/** Detecta errores de abort (DOMException AbortError / TimeoutError). */
function isAbortError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

export class GooglePlacesLeadSourceAdapter implements LeadSourceAdapter {
  /**
   * @param apiKey API key de Places (va por header X-Goog-Api-Key).
   * @param timeoutMs Timeout por llamada en ms (default 15000; inyectable para tests).
   */
  constructor(
    private apiKey: string,
    private timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {}

  // IMPORTANTE: el route selecciona adapters por `name` (sourceAdapter);
  // debe seguir siendo "Google Places API". "google_places" es solo el
  // identificador del proveedor dentro del envelope.
  name = "Google Places API";
  description =
    "Fuente oficial Google Places API (New). Requiere API key con Places API habilitada en Google Cloud Console.";

  async isConfigured() {
    return Boolean(this.apiKey && this.apiKey.length > 10);
  }

  /**
   * Contrato 1: textQuery = [category, keywords].join(" ") + " in <city>" + (", <country>").
   * Ej: category="clínica estética", keywords="laser", city="Bogotá", country="CO"
   * → "clínica estética laser in Bogotá, CO".
   */
  private buildTextQuery(input: SearchInput): string {
    const base = [input.category, input.keywords].filter(Boolean).join(" ");
    const tail = input.country ? `, ${input.country}` : "";
    return `${base} in ${input.city}${tail}`;
  }

  /** Mapea un place de Places API (New) al prospecto normalizado. */
  private mapPlace(p: PlacesPlace, input: SearchInput): RawProspect {
    return {
      name: p.displayName?.text || "Sin nombre",
      category: p.primaryTypeDisplayName?.text || input.category,
      address: p.formattedAddress,
      city: input.city,
      country: input.country,
      website: p.websiteUri || undefined,
      phone: p.internationalPhoneNumber || undefined,
      description: p.editorialSummary?.text || undefined,
      source: PROVIDER,
      sourceUrl: p.googleMapsUri || undefined,
      // P1 contrato 1: enriquecimiento Places. Cuidado con 0 legítimos
      // (rating 0, lat/lng 0): se usa ?? / typeof, NUNCA truthiness.
      placeId: p.id || undefined,
      lat: p.location?.latitude ?? undefined,
      lng: p.location?.longitude ?? undefined,
      rating: p.rating ?? undefined,
      ratingCount: p.userRatingCount ?? undefined,
      businessStatus: p.businessStatus || undefined,
      // NUNCA isMock aquí: los datos son reales del proveedor.
    };
  }

  /**
   * Búsqueda Text Search con paginación. Cada llamada HTTP tiene su propio
   * AbortController con timeout (el token de página debe repetir el resto
   * de parámetros idénticos, según la especificación de Places).
   */
  async search(input: SearchInput): Promise<ProviderResult<RawProspect[]>> {
    // Sin API key → fallo AUTH sin tocar la red.
    if (!this.apiKey) {
      return providerFail(PROVIDER, "AUTH", "API key ausente");
    }
    // city es obligatorio para Places Text Search.
    if (!input?.city) {
      return providerFail(
        PROVIDER,
        "INVALID_INPUT",
        "'city' es obligatorio para buscar en Google Places"
      );
    }

    const startedAt = Date.now();
    const textQuery = this.buildTextQuery(input);
    const allPlaces: PlacesPlace[] = [];
    let calls = 0;
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      // Parámetros idénticos en cada página (requerido para pageToken).
      const body: Record<string, unknown> = {
        textQuery,
        languageCode: "es",
        regionCode: input.country || "CO",
      };
      if (pageToken) body.pageToken = pageToken;

      // Timeout por llamada: AbortController dedicado (contrato 1).
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      let res: Response;
      try {
        res = await fetch(PLACES_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": this.apiKey, // key SOLO por header
            "X-Goog-FieldMask": FIELD_MASK,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        // Abort → TIMEOUT; cualquier otro rechazo (red/DNS) → UNAVAILABLE.
        if (isAbortError(err)) {
          return providerFail(
            PROVIDER,
            "TIMEOUT",
            `Google Places no respondió en ${this.timeoutMs}ms (llamada ${calls + 1})`,
            { meta: this.partialMeta(calls, startedAt) }
          );
        }
        return providerFail(
          PROVIDER,
          "UNAVAILABLE",
          `Error de red contactando Google Places: ${
            err instanceof Error ? err.message : String(err)
          }`,
          { meta: this.partialMeta(calls, startedAt) }
        );
      }
      clearTimeout(timer);
      calls++;

      // Error HTTP → clasificación del contrato 7, tal cual emite
      // classifyHttpError (code/retryable/httpStatus preservados).
      if (!res.ok) {
        const errorBody = await res.text().catch(() => "");
        const classified = classifyHttpError(PROVIDER, res.status, errorBody);
        return providerFail(
          classified.provider,
          classified.code,
          classified.message,
          {
            httpStatus: classified.httpStatus,
            retryable: classified.retryable,
            meta: this.partialMeta(calls, startedAt),
          }
        );
      }

      let data: PlacesSearchResponse;
      try {
        data = (await res.json()) as PlacesSearchResponse;
      } catch {
        return providerFail(
          PROVIDER,
          "UNKNOWN",
          "Google Places devolvió una respuesta no-JSON",
          { httpStatus: res.status, meta: this.partialMeta(calls, startedAt) }
        );
      }

      // places ausente o no-array → array vacío (EMPTY lo decide el orquestador).
      const places = Array.isArray(data.places) ? data.places : [];
      allPlaces.push(...places);

      // Paginación: repetir mientras haya nextPageToken (máx. MAX_PAGES).
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }

    return providerOk(
      allPlaces.map((p) => this.mapPlace(p, input)),
      providerMeta(PROVIDER, calls, Date.now() - startedAt)
    );
  }

  /** Meta parcial de coste/llamadas para envelopes de fallo (trazabilidad). */
  private partialMeta(calls: number, startedAt: number): ProviderCallMeta {
    return providerMeta(PROVIDER, calls, Date.now() - startedAt);
  }
}
