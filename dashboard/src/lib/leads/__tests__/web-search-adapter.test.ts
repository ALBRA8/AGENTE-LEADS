// ============================================================
// src/lib/leads/__tests__/web-search-adapter.test.ts
// P0-C: regresión de extracción de teléfono/email.
//
// El defecto: web-search-adapter.ts persistía `match[0]` sobre el
// STRING COMPLETO que ya devolvían extractPhone/extractEmail → se
// guardaba solo el primer carácter ("+" para teléfonos, "c" para
// emails). Estos tests fijan el contrato: valores COMPLETOS +
// normalización E.164-ish + gate de validez en el enriquecimiento.
//
// SIN RED: `z-ai-web-dev-sdk` se mockea con vi.mock (el adapter llega
// al SDK vía getAIClient() de @/lib/ai/client, que importa ZAI de
// "z-ai-web-dev-sdk"). Ninguna llamada real.
// ============================================================
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, createMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock("z-ai-web-dev-sdk", () => ({
  default: {
    create: createMock,
  },
}));

import {
  WebSearchLeadSourceAdapter,
  extractEmail,
  extractPhone,
  isValidEmail,
  isValidPhone,
  normalizeEmail,
  normalizePhone,
} from "../web-search-adapter";
import { mockAestheticClinics } from "../mock-source-data";

// ────────────────────────────────────────────────────────────
// extractPhone — valores COMPLETOS (no el primer carácter "+")
// ────────────────────────────────────────────────────────────
describe("extractPhone", () => {
  it("devuelve el número COMPLETO de un snippet de texto (no '+')", () => {
    const result = extractPhone(
      "Clínica de estética en Bogotá. Llámanos al +57 601 123 4567 para reservas."
    );
    expect(result).toBe("+57 601 123 4567");
    expect(result?.length).toBeGreaterThan(1);
  });

  it("devuelve el número COMPLETO dentro de HTML (tel: link)", () => {
    const result = extractPhone(
      '<a href="tel:+57 311 555 1234">+57 311 555 1234</a>'
    );
    expect(result).toBe("+57 311 555 1234");
  });

  it("extrae fijo colombiano con formato local", () => {
    const result = extractPhone("Horario de atención, PBX 601 745 8900 Bogotá");
    expect(result).toBe("601 745 8900");
  });

  it("rechaza IDs numéricos largos (>15 dígitos)", () => {
    expect(extractPhone("Referencia 12345678901234567890 fin")).toBeUndefined();
  });

  it("rechaza artefactos CSS tipo '0 0 24 24'", () => {
    expect(extractPhone('<svg viewBox="0 0 24 24"></svg>')).toBeUndefined();
  });

  it("rechaza números con dígitos repetidos en exceso", () => {
    expect(extractPhone("Clave 99999999999 nueva")).toBeUndefined();
  });

  it("rechaza secuencias con mayoría de ceros", () => {
    expect(extractPhone("Ruta 0 0 0 0 0 0 0 0 5")).toBeUndefined();
  });

  it("devuelve undefined sin texto o sin candidatos", () => {
    expect(extractPhone(undefined)).toBeUndefined();
    expect(extractPhone("")).toBeUndefined();
    expect(extractPhone("Sin números aquí")).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────
// extractEmail — valores COMPLETOS (no el primer carácter "c")
// ────────────────────────────────────────────────────────────
describe("extractEmail", () => {
  it("devuelve el email COMPLETO con subdominios (no 'c')", () => {
    const result = extractEmail(
      "Escríbenos a Info@Mail.ClinicaBelleza.com.co hoy mismo."
    );
    expect(result).toBe("Info@Mail.ClinicaBelleza.com.co");
    expect(result?.length).toBeGreaterThan(1);
  });

  it("extrae desde HTML mailto preservando el valor completo", () => {
    const result = extractEmail(
      '<a href="mailto:Citas@Dermastetic.com.co">Citas@Dermastetic.com.co</a>'
    );
    expect(result).toBe("Citas@Dermastetic.com.co");
  });

  it("rechaza assets con extensiones de imagen/estáticos", () => {
    expect(extractEmail("bg-fondo@cdn.site.com.png")).toBeUndefined();
    expect(extractEmail("sprite-iconos@cdn.ejemplo.com.svg")).toBeUndefined();
  });

  it("rechaza prefijos de asset (bg-, icon-, sprite-)", () => {
    expect(extractEmail("icon-mail@site.com")).toBeUndefined();
  });

  it("rechaza partes locales demasiado largas (artefactos CSS)", () => {
    const long = "a".repeat(31);
    expect(extractEmail(`${long}@ejemplo.com`)).toBeUndefined();
  });

  it("devuelve undefined sin texto o sin emails", () => {
    expect(extractEmail(undefined)).toBeUndefined();
    expect(extractEmail("Contacta sin correo aquí")).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────
// Normalización E.164-ish / lowercase
// ────────────────────────────────────────────────────────────
describe("normalizePhone", () => {
  it("normaliza +57 601 123 4567 -> +576011234567", () => {
    expect(normalizePhone("+57 601 123 4567")).toBe("+576011234567");
  });

  it("conserva el + inicial y elimina separadores redundantes", () => {
    expect(normalizePhone("+57-601-123-4567")).toBe("+576011234567");
    expect(normalizePhone("+57 (601) 123 4567")).toBe("+576011234567");
    expect(normalizePhone("  +57.601.123.4567  ")).toBe("+576011234567");
  });

  it("sin + inicial no lo inventa", () => {
    expect(normalizePhone("601 123 4567")).toBe("6011234567");
  });

  it("devuelve undefined con vacío o basura sin dígitos", () => {
    expect(normalizePhone(undefined)).toBeUndefined();
    expect(normalizePhone("")).toBeUndefined();
    expect(normalizePhone("+")).toBeUndefined(); // valor corrupto del defecto
    expect(normalizePhone("no hay")).toBeUndefined();
  });
});

describe("normalizeEmail", () => {
  it("aplica trim + lowercase", () => {
    expect(normalizeEmail("  Contacto@ClinicaBelleza.COM  ")).toBe(
      "contacto@clinicabelleza.com"
    );
  });

  it("preserva un valor ya normalizado", () => {
    expect(normalizeEmail("info@renacer-estetica.co")).toBe(
      "info@renacer-estetica.co"
    );
  });

  it("devuelve undefined con vacío", () => {
    expect(normalizeEmail(undefined)).toBeUndefined();
    expect(normalizeEmail("   ")).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────
// Gate de validez — rechaza explícitamente los datos corruptos
// que persistía el defecto original ("+", "c")
// ────────────────────────────────────────────────────────────
describe("isValidPhone / isValidEmail", () => {
  it("rechaza los valores corruptos del defecto original ('+' y 'c')", () => {
    expect(isValidPhone("+")).toBe(false);
    expect(isValidPhone("c")).toBe(false);
    expect(isValidEmail("c")).toBe(false);
    expect(isValidEmail("+")).toBe(false);
  });

  it("valida teléfonos por rango E.164 (7-15 dígitos)", () => {
    expect(isValidPhone("123456")).toBe(false); // <7 dígitos
    expect(isValidPhone("1234567890123456")).toBe(false); // >15 dígitos
    expect(isValidPhone("1234567")).toBe(true);
    expect(isValidPhone("601 123 4567")).toBe(true);
    expect(isValidPhone("+576011234567")).toBe(true);
  });

  it("valida estructura local@dominio con dominio punteado", () => {
    expect(isValidEmail("sin-arroba")).toBe(false);
    expect(isValidEmail("usuario@dominio")).toBe(false); // sin "."
    expect(isValidEmail("usuario@dominio.com")).toBe(true);
    expect(isValidEmail("a@b.co")).toBe(true);
  });

  it("devuelve false con vacío/undefined", () => {
    expect(isValidPhone(undefined)).toBe(false);
    expect(isValidPhone("")).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// Integración del adapter con el SDK mockeado
// ────────────────────────────────────────────────────────────
type MockSearchResult = {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
  date?: string;
};

const WEB_SEARCH_RESULTS: MockSearchResult[] = [
  {
    url: "https://clinica-belleza-bogota.com/contacto",
    name: "Clínica Belleza Bogotá - Contacto",
    snippet:
      "Clínica de estética en Bogotá. Llámanos al +57 601 123 4567 o escríbenos a Contacto@ClinicaBelleza.com para citas.",
    host_name: "clinica-belleza-bogota.com",
  },
  {
    url: "https://www.renacer-estetica.co/",
    name: "Centro Médico Estético Renacer | Bogotá",
    snippet:
      "Medicina estética en Bogotá desde 2015. Liposucción no invasiva, hilos tensores y depilación láser. Equipo médico certificado.",
    host_name: "www.renacer-estetica.co",
  },
  {
    url: "https://dermastetic-ejemplo.com.co/nosotros",
    name: "Dermastetic Ejemplo :: Nosotros",
    snippet:
      "Dermatología estética en Bogotá. Tratamientos para acné y manchas con tecnología láser. Atención personalizada desde 2012.",
    host_name: "dermastetic-ejemplo.com.co",
  },
  {
    url: "https://www.facebook.com/clinicaejemplo",
    name: "Clínica Ejemplo - Facebook",
    snippet: "Teléfono +57 601 999 8877. Escríbenos por Messenger.",
    host_name: "facebook.com",
  },
];

const RENACER_HTML =
  "<html><body><p>Agenda tu cita: +57 311 555 1234 — correo INFO@Renacer-Estetica.co</p></body></html>";

const BELLEZA_HTML_ALTERNATE =
  "<html><body><p>Central de citas: +57 118 000 9999</p></body></html>";

const NO_CONTACT_HTML =
  "<html><body><p>Solo atención presencial. Visítanos en nuestra sede.</p></body></html>";

describe("WebSearchLeadSourceAdapter.search (sdk mockeado)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    createMock.mockReset();
    createMock.mockResolvedValue({ functions: { invoke: invokeMock } });
  });

  it("conserva el teléfono '+576011234567' y el email completos (NO '+', NO 'c')", async () => {
    invokeMock.mockImplementation(
      async (fnName: string, args?: { url?: string }) => {
        if (fnName === "web_search") return WEB_SEARCH_RESULTS;
        if (fnName === "page_reader") {
          if (args?.url?.includes("renacer-estetica.co"))
            return { data: { html: RENACER_HTML } };
          if (args?.url?.includes("dermastetic-ejemplo"))
            return { data: { html: NO_CONTACT_HTML } };
          return { data: { html: BELLEZA_HTML_ALTERNATE } };
        }
        return null;
      }
    );

    const prospects = await WebSearchLeadSourceAdapter.search({
      city: "Bogotá",
      country: "Colombia",
      category: "clínica de estética",
    });

    // El resultado de Facebook se descarta por skipHosts
    expect(prospects).toHaveLength(3);

    // P1: contacto completo en el snippet → persistido completo + normalizado
    const belleza = prospects[0];
    expect(belleza.name).toBe("Clínica Belleza Bogotá");
    expect(belleza.phone).toBe("+576011234567");
    expect(belleza.email).toBe("contacto@clinicabelleza.com");
    // regresión explícita del defecto P0-C:
    expect(belleza.phone).not.toBe("+");
    expect(belleza.email).not.toBe("c");

    // P2: snippet sin contacto → enriquecido vía page_reader con valores completos
    const renacer = prospects[1];
    expect(renacer.name).toBe("Centro Médico Estético Renacer");
    expect(renacer.phone).toBe("+573115551234"); // "+57 311 555 1234" normalizado
    expect(renacer.email).toBe("info@renacer-estetica.co"); // lowercase
    expect(invokeMock).toHaveBeenCalledWith("page_reader", {
      url: "https://www.renacer-estetica.co/",
    });

    // P3: sin contacto en ninguna parte → undefined (no "+" ni "c")
    const dermastetic = prospects[2];
    expect(dermastetic.name).toBe("Dermastetic Ejemplo");
    expect(dermastetic.phone).toBeUndefined();
    expect(dermastetic.email).toBeUndefined();

    // La búsqueda se pidió con la query construida
    expect(invokeMock).toHaveBeenCalledWith(
      "web_search",
      expect.objectContaining({ query: "clínica de estética en Bogotá Colombia" })
    );
  });

  it("NO sobrescribe contactos válidos existentes durante el enriquecimiento", async () => {
    invokeMock.mockImplementation(async (fnName: string) => {
      if (fnName === "web_search") return WEB_SEARCH_RESULTS;
      // Para la clínica 1 (contacto ya válido desde el snippet) page_reader
      // devuelve OTRO teléfono válido: no debe reemplazar al existente.
      return { data: { html: BELLEZA_HTML_ALTERNATE } };
    });

    const prospects = await WebSearchLeadSourceAdapter.search({
      city: "Bogotá",
      country: "Colombia",
    });

    expect(prospects[0].phone).toBe("+576011234567");
    expect(prospects[0].email).toBe("contacto@clinicabelleza.com");
  });

  it("devuelve [] sin lanzar cuando web_search falla", async () => {
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    invokeMock.mockRejectedValue(new Error("web_search caída"));

    const prospects = await WebSearchLeadSourceAdapter.search({
      city: "Bogotá",
    });

    expect(prospects).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith(
      "web_search",
      expect.objectContaining({ num: 20 })
    );
    errSpy.mockRestore();
  });

  it("devuelve [] cuando web_search no devuelve un array", async () => {
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    invokeMock.mockResolvedValue({ unexpected: "payload" });

    const prospects = await WebSearchLeadSourceAdapter.search({
      city: "Bogotá",
    });

    expect(prospects).toEqual([]);
    errSpy.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────
// Fixtures de datos demo (mock-adapter.ts → mock-source-data.ts)
// Verificación de la tarea 4: los fixtures usan valores completos,
// no truncados a 1 carácter.
// ────────────────────────────────────────────────────────────
describe("fixtures demo (mock-source-data)", () => {
  it("todos los teléfonos/emails definidos están completos y válidos", () => {
    for (const clinic of mockAestheticClinics) {
      if (clinic.phone !== undefined) {
        expect(
          clinic.phone.length,
          `teléfono truncado en "${clinic.name}": "${clinic.phone}"`
        ).toBeGreaterThan(1);
        expect(
          isValidPhone(clinic.phone),
          `teléfono inválido en "${clinic.name}": "${clinic.phone}"`
        ).toBe(true);
      }
      if (clinic.email !== undefined) {
        expect(
          clinic.email.length,
          `email truncado en "${clinic.name}": "${clinic.email}"`
        ).toBeGreaterThan(1);
        expect(
          isValidEmail(clinic.email),
          `email inválido en "${clinic.name}": "${clinic.email}"`
        ).toBe(true);
      }
    }
  });
});
