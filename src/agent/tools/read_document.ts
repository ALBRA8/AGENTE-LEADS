// ============================================================
// src/agent/tools/read_document.ts
//
// Tool read_document: descarga (URL http/https) o lee (ruta local)
// un documento PDF o Word (.docx) y extrae su texto para el LLM.
//
// Notas de implementación (pdf-parse 1.1.1):
//   1. El parser real vive en "pdf-parse/lib/pdf-parse.js". El entry point
//      index.js activa un "modo debug" cuando no detecta un require padre y,
//      bajo ESM, intenta leer un PDF de test inexistente y crashea. Por eso
//      se carga el submódulo con createRequire (los @types solo cubren el
//      entry point y el submódulo no tiene declaración).
//   2. El buffer se pasa como Uint8Array (no Buffer crudo): con un Buffer de
//      Node el transporte del fake-worker de pdf.js corrompe los bytes y el
//      lexer lanza "Invalid number: \b (charCode 8)".
//
// Límites: 15 MB por documento, timeout de descarga 20 s, y el texto
// devuelto al LLM se corta a 12000 caracteres (protege la ventana de
// contexto). Los errores siguen la taxonomía del repo
// (INVALID_INPUT / PROVIDER_UNAVAILABLE / TIMEOUT).
// ============================================================

import { createRequire } from "node:module";
import fs from "node:fs/promises";

import { Tool } from "../types.js";
import { makeError, type ErrorType } from "../core/errors.js";
import mammoth from "mammoth";

const TOOL_NAME = "read_document";

/** Límite de tamaño aceptado por documento (15 MB) — exportado para tests. */
export const READ_DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;
/** Timeout de descarga (20 s). */
export const READ_DOCUMENT_DOWNLOAD_TIMEOUT_MS = 20_000;
/** Corte del texto devuelto al LLM (protege la ventana de contexto). */
export const READ_DOCUMENT_MAX_TEXT_CHARS = 12_000;

// Tipado local del submódulo pdf-parse/lib/pdf-parse.js (sin @types).
interface PdfParseResult {
  numpages: number;
  numrender: number;
  info: unknown;
  metadata: unknown;
  version: string;
  text: string;
}
type PdfParseFn = (dataBuffer: Buffer | Uint8Array) => Promise<PdfParseResult>;

// Carga del parser real de pdf-parse (ver nota de implementación nº 1).
// createRequire resuelve desde este fichero (sube hasta node_modules) y
// funciona igual con tsx en desarrollo que con la build ESM en dist/.
const pdfParse = createRequire(import.meta.url)("pdf-parse/lib/pdf-parse.js") as PdfParseFn;

/** Formatea el error con la taxonomía del repo (mismo estilo que enforceContract). */
function fail(type: ErrorType, message: string): string {
  const normalized = makeError(type, message, { provider: TOOL_NAME });
  return `Error [${TOOL_NAME}] (${normalized.type}): ${normalized.message}`;
}

/** Magic bytes: un PDF empieza con "%PDF", un DOCX es un ZIP que empieza con PK\x03\x04. */
function detectKind(bytes: Buffer): "pdf" | "docx" | null {
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString("latin1") === "%PDF") {
    return "pdf";
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "docx";
  }
  return null;
}

/** Extrae la extensión de la URL o de la ruta local (solo como pista para el mensaje de error). */
function extensionHint(source: string): string {
  const tail = source.replace(/[?#].*$/, "").split("/").pop() ?? "";
  const dot = tail.lastIndexOf(".");
  if (dot <= 0 || dot === tail.length - 1) return "";
  return tail.slice(dot + 1).toLowerCase();
}

export const readDocument: Tool = {
  definition: {
    type: "function",
    function: {
      name: "read_document",
      description:
        "Descarga y extrae el texto de un documento PDF o Word (.docx), por URL http(s) o por ruta local. " +
        "Úsala cuando encuentres un enlace a un PDF o .docx con información del negocio " +
        "(catálogos, precios, dossier del cliente, normativa, memorias) y necesitas leer su contenido. " +
        "Pasa exactamente un parámetro: 'url' (http/https) o 'path' (ruta local). " +
        "Límite: 15 MB; timeout de descarga: 20 s; devuelve los primeros 12000 caracteres del texto. " +
        "No sirve para PDFs escaneados sin capa de texto (imágenes).",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL http/https del documento (PDF o .docx)." },
          path: { type: "string", description: "Ruta local del documento (PDF o .docx)." }
        },
        required: []
      }
    }
  },
  async execute(args) {
    const url = typeof args.url === "string" && args.url.trim().length > 0 ? args.url.trim() : undefined;
    const localPath = typeof args.path === "string" && args.path.trim().length > 0 ? args.path.trim() : undefined;

    // ── 1. Validación de parámetros: exactamente uno ────────────
    if (!url && !localPath) {
      return fail(
        "INVALID_INPUT",
        "Debes indicar exactamente un parámetro: 'url' (http/https del PDF o .docx) o 'path' (ruta local)."
      );
    }
    if (url && localPath) {
      return fail("INVALID_INPUT", "Pasa solo un parámetro: 'url' o 'path', no ambos.");
    }

    // ── 2. Obtener los bytes del documento ──────────────────────
    let bytes: Buffer;
    let source: string;

    if (url) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return fail("INVALID_INPUT", `URL malformada: ${url}`);
      }
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return fail("INVALID_INPUT", `Solo se aceptan URLs http/https (recibido: ${parsedUrl.protocol}).`);
      }

      // Descarga con timeout de 20 s (AbortController).
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), READ_DOCUMENT_DOWNLOAD_TIMEOUT_MS);
      timer.unref?.();
      try {
        const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
        if (!response.ok) {
          return fail(
            "PROVIDER_UNAVAILABLE",
            `La descarga falló con estado HTTP ${response.status} ${response.statusText} para ${url}.`
          );
        }
        // Si el servidor declara el tamaño, rechaza antes de descargar el cuerpo.
        const declared = Number(response.headers.get("content-length") ?? "0");
        if (Number.isFinite(declared) && declared > READ_DOCUMENT_MAX_BYTES) {
          return fail(
            "INVALID_INPUT",
            `El documento declarado (${declared} bytes) supera el límite de ${READ_DOCUMENT_MAX_BYTES} bytes (15 MB).`
          );
        }
        bytes = Buffer.from(await response.arrayBuffer());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (controller.signal.aborted) {
          return fail("TIMEOUT", `La descarga excedió ${READ_DOCUMENT_DOWNLOAD_TIMEOUT_MS / 1000} segundos: ${url}`);
        }
        return fail("PROVIDER_UNAVAILABLE", `No se pudo descargar el documento (${msg}).`);
      } finally {
        clearTimeout(timer);
      }
      source = url;
    } else {
      // Lectura de fichero local.
      try {
        const stat = await fs.stat(localPath!);
        if (!stat.isFile()) {
          return fail("PROVIDER_UNAVAILABLE", `La ruta existe pero no es un fichero: ${localPath}`);
        }
        if (stat.size > READ_DOCUMENT_MAX_BYTES) {
          return fail(
            "INVALID_INPUT",
            `El fichero (${stat.size} bytes) supera el límite de ${READ_DOCUMENT_MAX_BYTES} bytes (15 MB).`
          );
        }
        bytes = await fs.readFile(localPath!);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail("PROVIDER_UNAVAILABLE", `No se pudo leer el fichero local (${msg}).`);
      }
      source = localPath!;
    }

    // ── 3. Límite por contenido real (Content-Length puede faltar o mentir) ──
    if (bytes.length > READ_DOCUMENT_MAX_BYTES) {
      return fail(
        "INVALID_INPUT",
        `El documento (${bytes.length} bytes) supera el límite de ${READ_DOCUMENT_MAX_BYTES} bytes (15 MB).`
      );
    }

    // ── 4. Detección de tipo por magic bytes ────────────────────
    const kind = detectKind(bytes);
    if (!kind) {
      const ext = extensionHint(source);
      const pista = ext ? ` La extensión "${ext}" no corresponde a un tipo soportado o los bytes no coinciden.` : "";
      return fail(
        "INVALID_INPUT",
        `Tipo de documento no soportado.${pista} Tipos soportados: PDF (magic bytes %PDF) y Word .docx (ZIP, magic bytes PK).`
      );
    }

    // ── 5. Extracción de texto ──────────────────────────────────
    let text = "";
    let pages: number | undefined;
    try {
      if (kind === "pdf") {
        // Uint8Array (no Buffer crudo): evita la corrupción de bytes en el
        // transporte del fake-worker de pdf.js (ver nota de implementación).
        const parsed = await pdfParse(new Uint8Array(bytes));
        text = parsed.text ?? "";
        pages = parsed.numpages;
      } else {
        const result = await mammoth.extractRawText({ buffer: bytes });
        text = result.value ?? "";
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(
        "INVALID_INPUT",
        `No se pudo extraer el texto del documento ${kind.toUpperCase()} (${msg}). El archivo puede estar corrupto, dañado o protegido con contraseña.`
      );
    }

    // ── 6. Resultado acotado para la ventana de contexto del LLM ──
    const totalChars = text.length;
    const truncated = totalChars > READ_DOCUMENT_MAX_TEXT_CHARS;
    const payload: Record<string, unknown> = {
      ok: true,
      kind,
      chars: totalChars,
      text: truncated ? text.slice(0, READ_DOCUMENT_MAX_TEXT_CHARS) : text,
      truncated,
    };
    // "pages" solo tiene sentido para PDF.
    if (kind === "pdf" && typeof pages === "number") {
      payload.pages = pages;
    }
    return JSON.stringify(payload);
  }
};
