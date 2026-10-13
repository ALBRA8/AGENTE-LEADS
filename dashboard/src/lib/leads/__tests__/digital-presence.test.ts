// ============================================================
// src/lib/leads/__tests__/digital-presence.test.ts
// Tests del contrato 3: clasificación de presencia digital en 4
// estados + confirmación de web + etiquetas en español para UI.
// ============================================================
import { describe, expect, it } from "vitest";
import {
  DIGITAL_PRESENCE_LABELS,
  classifyDigitalPresence,
  confirmWeb,
} from "../digital-presence";
import type { RawProspect } from "../types";

type Input = Pick<RawProspect, "website" | "socialLinks" | "sourceUrl" | "source">;

/** Fábrica de entradas de clasificación con defaults neutros. */
const input = (over: Partial<Input>): Input => ({
  source: "overpass",
  ...over,
});

describe("classifyDigitalPresence", () => {
  it("website truthy → WEB_PENDIENTE_DE_VERIFICAR (aun con redes sociales y sourceUrl)", () => {
    expect(
      classifyDigitalPresence(
        input({
          website: "https://clinicaestetica.com",
          socialLinks: { instagram: "https://instagram.com/clinica" },
          sourceUrl: "https://maps.example.com/clinica",
        })
      )
    ).toBe("WEB_PENDIENTE_DE_VERIFICAR");
  });

  it("website vacío (falsy) no cuenta como web declarada", () => {
    expect(classifyDigitalPresence(input({ website: "" }))).toBe(
      "SIN_WEB_CONFIRMADA"
    );
  });

  it.each([
    ["instagram", { instagram: "https://instagram.com/clinicaestetica" }],
    ["facebook", { facebook: "https://facebook.com/clinicaestetica" }],
    ["linkedin", { linkedin: "https://linkedin.com/company/clinicaestetica" }],
    ["twitter", { twitter: "https://twitter.com/clinicaestetica" }],
    ["tiktok", { tiktok: "https://tiktok.com/@clinicaestetica" }],
  ] as Array<[string, NonNullable<RawProspect["socialLinks"]>]>)(
    "red social %s con valor → SOLO_RED_SOCIAL_O_DIRECTORIO",
    (_red, links) => {
      expect(classifyDigitalPresence(input({ socialLinks: links }))).toBe(
        "SOLO_RED_SOCIAL_O_DIRECTORIO"
      );
    }
  );

  it("sin web, con sourceUrl y source !== mock (directorio/ficha) → SOLO_RED_SOCIAL_O_DIRECTORIO", () => {
    expect(
      classifyDigitalPresence(
        input({ source: "overpass", sourceUrl: "https://www.openstreetmap.org/way/1" })
      )
    ).toBe("SOLO_RED_SOCIAL_O_DIRECTORIO");
  });

  it("sourceUrl de un mock NO cuenta como presencia (contrato 10) → SIN_WEB_CONFIRMADA", () => {
    expect(
      classifyDigitalPresence(
        input({ source: "mock", sourceUrl: "https://demo.local/clinica" })
      )
    ).toBe("SIN_WEB_CONFIRMADA");
  });

  it("socialLinks con cadenas vacías o espacios no cuentan como presencia", () => {
    expect(
      classifyDigitalPresence(
        input({ socialLinks: { instagram: "", facebook: "   " } })
      )
    ).toBe("SIN_WEB_CONFIRMADA");
  });

  it("nada de nada (sin web, sin redes, sin sourceUrl) → SIN_WEB_CONFIRMADA", () => {
    expect(classifyDigitalPresence(input({}))).toBe("SIN_WEB_CONFIRMADA");
  });
});

describe("confirmWeb", () => {
  it("WEB_PENDIENTE_DE_VERIFICAR → WEB_PROPIA_CONFIRMADA (tras verificación)", () => {
    expect(confirmWeb("WEB_PENDIENTE_DE_VERIFICAR")).toBe(
      "WEB_PROPIA_CONFIRMADA"
    );
  });

  it("los demás estados se devuelven sin cambio (no se puede confirmar lo que no existe)", () => {
    expect(confirmWeb("WEB_PROPIA_CONFIRMADA")).toBe("WEB_PROPIA_CONFIRMADA");
    expect(confirmWeb("SOLO_RED_SOCIAL_O_DIRECTORIO")).toBe(
      "SOLO_RED_SOCIAL_O_DIRECTORIO"
    );
    expect(confirmWeb("SIN_WEB_CONFIRMADA")).toBe("SIN_WEB_CONFIRMADA");
  });
});

describe("DIGITAL_PRESENCE_LABELS", () => {
  it("cubre los 4 estados con etiquetas exactas en español", () => {
    expect(DIGITAL_PRESENCE_LABELS).toEqual({
      WEB_PROPIA_CONFIRMADA: "Web propia confirmada",
      SOLO_RED_SOCIAL_O_DIRECTORIO: "Solo red social o directorio",
      SIN_WEB_CONFIRMADA: "Sin web confirmada",
      WEB_PENDIENTE_DE_VERIFICAR: "Web por verificar",
    });
  });
});
