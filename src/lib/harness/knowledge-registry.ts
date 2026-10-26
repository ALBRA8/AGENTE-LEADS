// ============================================================
// src/lib/harness/knowledge-registry.ts — KnowledgeRegistry (FASE 5)
// ============================================================

export interface IKnowledgeModule {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly version: string;
  getContent(): Record<string, unknown>;
  validate(): boolean;
}

export class KnowledgeRegistry {
  private modules = new Map<string, IKnowledgeModule>();

  register(module: IKnowledgeModule): void {
    this.modules.set(module.id, module);
  }

  get(id: string): IKnowledgeModule | undefined {
    return this.modules.get(id);
  }

  list(): Array<{ id: string; name: string; category: string }> {
    return Array.from(this.modules.values()).map(m => ({
      id: m.id, name: m.name, category: m.category,
    }));
  }

  getByCategory(category: string): IKnowledgeModule[] {
    return Array.from(this.modules.values()).filter(m => m.category === category);
  }

  healthCheck(): { total: number; valid: number; invalid: string[] } {
    const invalid: string[] = [];
    let valid = 0;
    for (const m of this.modules.values()) {
      if (m.validate()) valid++;
      else invalid.push(m.id);
    }
    return { total: this.modules.size, valid, invalid };
  }
}

// ── AGENTE-LEADS built-in knowledge ──────────────────────

export function registerBuiltinKnowledge(registry: KnowledgeRegistry): void {
  // System prompt del agente (agent-prompts)
  registry.register({
    id: 'agent-system-prompt',
    name: 'System Prompt del Agente',
    category: 'agent-prompts',
    version: '1.0.0',
    getContent: () => ({
      prompt: `Eres AGENTE LEADS, el agente de prospección inteligente.
Objetivo: encontrar clientes potenciales, investigarlos, validarlos y entregar los mejores leads con evidencia.

Herramienta 1: run_lead_pipeline — pipeline completo (descubrir→investigar→validar→scoring→inteligencia→almacenar)
Herramienta 2: run_outreach — propuestas personalizadas con IA + envío (dry_run por defecto)

Reglas:
- Responde en español.
- Distingue "no encontrado" de "no tiene".
- Para outreach, SIEMPRE pregunta antes de dry_run=false.
- No afirmes capacidades que el sistema no tiene.`,
    }),
    validate: () => true,
  });

  // Prompt de Inteligencia LLM (P1.2)
  registry.register({
    id: 'intelligence-prompt',
    name: 'Prompt de Inteligencia LLM',
    category: 'agent-prompts',
    version: '1.0.0',
    getContent: () => ({
      prompt: `Eres el motor de Lead Intelligence de AGENTE LEADS. Razona sobre el lead y devuelve JSON con: summary, opportunity_size, outreach_angle, confidence, signals_used. Nunca inventes hechos.`,
    }),
    validate: () => true,
  });

  // Prompt de Outreach/Propuestas (P2.4)
  registry.register({
    id: 'outreach-prompt',
    name: 'Prompt de Generación de Propuestas',
    category: 'agent-prompts',
    version: '1.0.0',
    getContent: () => ({
      prompt: `Genera propuesta comercial personalizada. Menciona el nombre del negocio. Identifica pain point específico. Explica cómo la oferta ayuda. Llamada a la acción clara. 150-250 palabras.`,
    }),
    validate: () => true,
  });

  // Reglas de Scoring (P1.1)
  registry.register({
    id: 'scoring-rules',
    name: 'Reglas de Lead Score',
    category: 'scoring-rules',
    version: '1.0.0',
    getContent: () => ({
      weights: {
        email_validated_high: 20,
        email_validated_medium: 15,
        email_invalid: -10,
        domain_validated: 15,
        website_found: 10,
        phone_found: 5,
        instagram_found: 10,
        linkedin_found: 10,
        identity_consistent: 5,
        identity_conflict: -10,
      },
      stateBonus: {
        VALIDATED: 15, RESEARCHED: 10, DISCOVERED: 5, STORED: 15, FAILED: 0,
      },
      maxScore: 100,
      minScore: 0,
    }),
    validate: () => true,
  });

  // Reglas de Dedup (P0.7)
  registry.register({
    id: 'dedup-rules',
    name: 'Reglas de Deduplicación',
    category: 'dedup-rules',
    version: '1.0.0',
    getContent: () => ({
      matchLevels: ['EXACT', 'STRONG', 'PROBABLE', 'NO_MATCH'],
      exactSignals: ['email', 'website'],
      strongSignals: ['instagram', 'phone', 'domain'],
      probableSignals: ['normalized_name_location'],
    }),
    validate: () => true,
  });

  // Datos demo
  registry.register({
    id: 'demo-data',
    name: 'Datos Demo (clínicas estética Colombia)',
    category: 'demo-data',
    version: '1.0.0',
    getContent: () => ({
      cities: ['Bogotá', 'Medellín', 'Cali'],
      niche: 'clínica de estética',
      sampleCount: 19,
    }),
    validate: () => true,
  });
}
