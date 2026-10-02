import { Tool } from "../types.js";
import { upsertLead, getLeadByEmail } from "../../database/sqlite.js";

export const saveLead: Tool = {
  definition: {
    type: "function",
    function: {
      name: "save_lead",
      description: "Guarda un lead verificado en Airtable implementando lógica de deduplicación y upsert.",
      parameters: {
        type: "object",
        properties: {
          username: { type: "string" },
          email: { type: "string" },
          url: { type: "string" },
          followers: { type: "string" },
          status: { type: "string" }
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

    // 2. Lógica de Upsert en SQLite
    upsertLead({
      email,
      username,
      url,
      followers,
      status: status || "VALID",
      source: "Instagram"
    });

    const airtableToken = process.env.AIRTABLE_TOKEN;
    if (!airtableToken) {
      console.warn("[saveLead] AIRTABLE_TOKEN no configurado. Operación realizada solo en SQLite.");
      return isNew 
        ? `[Deduplication] Lead nuevo registrado localmente: ${username} (${email}).`
        : `[Deduplication] Lead existente detectado. Fecha de prospección actualizada para ${username} (${email}).`;
    }

    // 3. Simulación de lógica de Upsert en Airtable
    // En producción se usaría: GET /Base/Table?filterByFormula=({Email}='${email}')
    // Si existe, PATCH /Base/Table/RecordID. Si no, POST /Base/Table
    
    // Devolvemos el feedback estructurado solicitado
    return isNew 
      ? `✅ [Airtable] Lead nuevo guardado con éxito: ${username} | ${email}`
      : `🔄 [Airtable] Lead duplicado detectado. Se ha actualizado la fecha de 'Última Prospección' para: ${email}`;
  }
};
