// ============================================================
// tests/read_document.test.ts — Tool read_document (PDF/DOCX)
//
// Los fixtures NO son ficheros binarios externos: el PDF mínimo
// (con xref correcta) y el DOCX mínimo (ZIP "store" con CRC32 que
// contiene [Content_Types].xml, _rels y word/document.xml) se
// construyen EN el test con helpers locales. pdf-parse (pdf.js) y
// mammoth los parsean como documentos reales.
//
// Nota sobre el límite de 15 MB: la tool solo acepta 'url'/'path'
// (no buffers), así que para el caso (f) se genera un fichero real
// de READ_DOCUMENT_MAX_BYTES + 1 bytes en el directorio temporal.
// El límite está exportado como constante precisamente para que el
// test pueda referenciarlo sin hardcodear 15 MB.
// ============================================================

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  readDocument,
  READ_DOCUMENT_MAX_BYTES,
  READ_DOCUMENT_MAX_TEXT_CHARS,
} from "../src/agent/tools/read_document.js";

// ── Helpers de fixtures (mismo estilo: comentarios en español) ──

/** Tabla CRC32 estándar (polinomio 0xEDB88320). */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * ZIP mínimo sin compresión (método "store") con CRC32 correcto:
 * cabeceras locales + central directory + EOCD. Suficiente para que
 * mammoth (jszip) lo abra como un DOCX.
 */
function zipStore(files: { name: string; data: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // firma PK\x03\x04
    local.writeUInt16LE(20, 4);         // versión necesaria
    local.writeUInt16LE(0, 6);          // flags
    local.writeUInt16LE(0, 8);          // método: store (sin compresión)
    local.writeUInt16LE(0, 10);         // hora modificación
    local.writeUInt16LE(0, 12);         // fecha modificación
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18); // tamaño comprimido
    local.writeUInt32LE(f.data.length, 22); // tamaño original
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);         // extra length
    localParts.push(local, nameBuf, f.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // firma central directory
    central.writeUInt16LE(20, 4);         // versión creada por
    central.writeUInt16LE(20, 6);         // versión necesaria
    central.writeUInt16LE(0, 8);          // flags
    central.writeUInt16LE(0, 10);         // método: store
    central.writeUInt16LE(0, 12);         // hora
    central.writeUInt16LE(0, 14);         // fecha
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(f.data.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);         // extra length
    central.writeUInt16LE(0, 32);         // comment length
    central.writeUInt16LE(0, 34);         // disco de inicio
    central.writeUInt16LE(0, 36);         // atributos internos
    central.writeUInt32LE(0, 38);         // atributos externos
    central.writeUInt32LE(offset, 42);    // offset de la cabecera local
    centralParts.push(central, nameBuf);

    offset += 30 + nameBuf.length + f.data.length;
  }
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // firma EOCD
  eocd.writeUInt16LE(0, 4);          // disco
  eocd.writeUInt16LE(0, 6);          // disco del central directory
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);    // offset del central directory
  eocd.writeUInt16LE(0, 20);         // comment length
  return Buffer.concat([...localParts, centralBuf, eocd]);
}

/** PDF de una página, construido a mano con tabla xref con offsets correctos. */
function buildPdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  bodies.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${bodies.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/** DOCX mínimo: [Content_Types].xml + _rels/.rels + word/document.xml con el texto dado. */
function buildDocx(text: string): Buffer {
  return zipStore([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `</Types>`,
        "utf8"
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
        `</Relationships>`,
        "utf8"
      ),
    },
    {
      name: "word/_rels/document.xml.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
        "utf8"
      ),
    },
    {
      name: "word/document.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>` +
        `</w:document>`,
        "utf8"
      ),
    },
  ]);
}

// ── Estado compartido de los tests ─────────────────────────────
let tmpDir = "";
let server: http.Server | null = null;
let baseUrl = "";

before(async () => {
  tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "read-document-test-"));

  // Servidor http local para probar la vía URL.
  // IMPORTANTE: aquí se invoca la tool CRUDO (readDocument.execute), sin
  // el envoltorio enforceContract del registry; el guard SSRF corre a nivel
  // de contrato y rechazaría 127.0.0.1 en producción.
  const pdfBytes = buildPdf("Documento de prueba AGENTE LEADS");
  server = http.createServer((req, res) => {
    if (req.url === "/documento.pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end(pdfBytes);
    } else {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("no encontrado");
    }
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve();
    server.close((err) => (err ? reject(err) : resolve()));
  });
  fsSync.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ──────────────────────────────────────────────────────

test("read_document: extrae el texto del PDF de prueba por ruta local", async () => {
  const pdfPath = path.join(tmpDir, "prueba.pdf");
  await fs.writeFile(pdfPath, buildPdf("Documento de prueba AGENTE LEADS"));

  const result = await readDocument.execute({ path: pdfPath });
  const payload = JSON.parse(result) as {
    ok: boolean; kind: string; pages: number; chars: number; text: string; truncated: boolean;
  };

  assert.equal(payload.ok, true);
  assert.equal(payload.kind, "pdf");
  assert.equal(payload.pages, 1);
  assert.ok(payload.text.includes("Documento de prueba AGENTE LEADS"), `texto: ${payload.text}`);
  assert.equal(payload.truncated, false);
  assert.equal(payload.chars, payload.text.length);
});

test("read_document: extrae el texto del DOCX de prueba por ruta local", async () => {
  const docxPath = path.join(tmpDir, "prueba.docx");
  await fs.writeFile(docxPath, buildDocx("Texto de prueba DOCX para AGENTE LEADS"));

  const result = await readDocument.execute({ path: docxPath });
  const payload = JSON.parse(result) as {
    ok: boolean; kind: string; pages?: number; chars: number; text: string; truncated: boolean;
  };

  assert.equal(payload.ok, true);
  assert.equal(payload.kind, "docx");
  assert.ok(payload.text.includes("Texto de prueba DOCX para AGENTE LEADS"), `texto: ${payload.text}`);
  assert.equal(payload.truncated, false);
  // "pages" solo aplica a PDF.
  assert.equal(payload.pages, undefined);
});

test("read_document: descarga y lee un PDF por URL (servidor http local)", async () => {
  const result = await readDocument.execute({ url: `${baseUrl}/documento.pdf` });
  const payload = JSON.parse(result) as { ok: boolean; kind: string; text: string };

  assert.equal(payload.ok, true);
  assert.equal(payload.kind, "pdf");
  assert.ok(payload.text.includes("Documento de prueba AGENTE LEADS"));
});

test("read_document: HTTP 404 en la URL devuelve PROVIDER_UNAVAILABLE", async () => {
  const result = await readDocument.execute({ url: `${baseUrl}/faltante.pdf` });
  assert.match(result, /PROVIDER_UNAVAILABLE/);
  assert.match(result, /404/);
});

test("read_document: bytes PNG (tipo no soportado) devuelven INVALID_INPUT con los tipos soportados", async () => {
  const pngPath = path.join(tmpDir, "imagen.png");
  // Magic bytes reales de un PNG, sin documento PDF/DOCX detrás.
  await fs.writeFile(
    pngPath,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52])
  );

  const result = await readDocument.execute({ path: pngPath });
  assert.match(result, /INVALID_INPUT/);
  assert.match(result, /Tipo de documento no soportado/);
  assert.match(result, /Tipos soportados: PDF/);
});

test("read_document: sin url ni path devuelve INVALID_INPUT", async () => {
  const result = await readDocument.execute({});
  assert.match(result, /INVALID_INPUT/);
  assert.match(result, /exactamente un parámetro/);
});

test("read_document: url y path a la vez devuelven INVALID_INPUT", async () => {
  const result = await readDocument.execute({
    url: `${baseUrl}/documento.pdf`,
    path: path.join(tmpDir, "prueba.pdf"),
  });
  assert.match(result, /INVALID_INPUT/);
  assert.match(result, /no ambos/);
});

test("read_document: URL con esquema no http/https devuelve INVALID_INPUT", async () => {
  const result = await readDocument.execute({ url: "ftp://ejemplo.com/documento.pdf" });
  assert.match(result, /INVALID_INPUT/);
  assert.match(result, /http\/https/);
});

test("read_document: path inexistente devuelve PROVIDER_UNAVAILABLE", async () => {
  const result = await readDocument.execute({ path: path.join(tmpDir, "no-existe.pdf") });
  assert.match(result, /PROVIDER_UNAVAILABLE/);
  assert.match(result, /No se pudo leer el fichero local/);
});

test("read_document: un documento que excede el límite de 15 MB devuelve INVALID_INPUT", async () => {
  // El límite está exportado como READ_DOCUMENT_MAX_BYTES; como la tool solo
  // acepta url/path (no buffers), se escribe un fichero real de límite + 1 byte
  // (rápido: la tool lo rechaza por tamaño ANTES de leerlo o detectar el tipo).
  const grandePath = path.join(tmpDir, "grande.pdf");
  await fs.writeFile(grandePath, Buffer.alloc(READ_DOCUMENT_MAX_BYTES + 1, 0x41));

  const result = await readDocument.execute({ path: grandePath });
  assert.match(result, /INVALID_INPUT/);
  assert.match(result, /supera el límite de 15728640 bytes \(15 MB\)/);
});

test("read_document: corta el texto a 12000 caracteres con truncated=true", async () => {
  const largo = "INICIO-TRUNCADO " + "a".repeat(13000);
  const docxPath = path.join(tmpDir, "largo.docx");
  await fs.writeFile(docxPath, buildDocx(largo));

  const result = await readDocument.execute({ path: docxPath });
  const payload = JSON.parse(result) as {
    ok: boolean; kind: string; chars: number; text: string; truncated: boolean;
  };

  assert.equal(payload.ok, true);
  assert.equal(payload.truncated, true);
  assert.equal(payload.text.length, READ_DOCUMENT_MAX_TEXT_CHARS);
  assert.ok(payload.chars > READ_DOCUMENT_MAX_TEXT_CHARS);
  assert.ok(payload.text.startsWith("INICIO-TRUNCADO"));
});
