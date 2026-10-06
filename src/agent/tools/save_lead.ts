// ============================================================
// src/agent/tools/save_lead.ts
//
// FIXED (P0 auditoría): la descripción anterior mencionaba "Airtable"
// pero la implementación solo escribe en SQLite. Corregida para que
// la descripción coincida con la capacidad real.
//
// NOTA: Esta tool legacy se mantiene por compatibilidad. Para nuevos
// flujos, usar el tool `run_lead_pipeline` que invoca el pipeline
// V2 con deduplicación multi-señal y almacenamiento separado en
// `lead_intelligence_leads`.
// ============================================================

import { Tool } from "../types.js";
import { upsertLead, getLeadByEmail } from "../../database/sqlite.js";

export const saveLead: Tool = {
  definition: {
    type: "function",
    function: {
      name: "save_lead",
      description:
        "Guarda un lead en la base de datos local SQLite (tabla `leads`), " +
        "con deduplicación por email (upsert). " +
        "La persistencia es exclusivamente local (SQLite). " +
        "Para flujos nuevos, prefiere el tool `run_lead_pipeline` que usa " +
        "deduplicación multi-señal y la base de datos `lead_intelligence_leads`.",
      parameters: {
        type: "object",
        properties: {
          username: { type: "string", description: "Username de la red social (sin @)" },
          email: { type: "string", description: "Email del lead (clave de deduplicación)" },
          url: { type: "string", description: "URL del perfil o web" },
          followers: { type: "string", description: "Número de seguidores" },
          status: { type: "string", description: "Estado del lead (default: 'VALID')" }
        },
        required: ["username", "email"]
      }
    }
  },
  async execute(args) {
    const { username, email, url, followers, status } = args as any;

    // 1. Deduplicación local mediante SQLite
    const existingLocal = getLeadByEmail(email);
    const isNew = !existingLocal;

    // 2. Upsert en SQLite local (ÚNICA persistencia real)
    upsertLead({
      email,
      username,
      url,
      followers,
      status: status || "VALID",
      source: "Instagram"
    });

    if (isNew) {
      return `[SQLite] Lead nuevo registrado localmente: ${username} (${email}).`;
    }
    return `[SQLite] Lead existente detectado. Fecha de prospección actualizada para ${username} (${email}).`;
  },
};
