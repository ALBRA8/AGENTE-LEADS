// ============================================================
// src/lib/adapters/general-adapter.ts — GeneralAdapter (FASE 6)
// The interchangeable agent. Plugs into any project's harness.
// ============================================================

import type { AgentAdapter, HarnessContext, AdapterResult, AgentCapability, HealthStatus } from './types.js';

export class GeneralAdapter implements AgentAdapter {
  readonly id = 'agente-general';
  readonly name = 'AGENTE-GENERAL';
  readonly version = '1.0.0';
  readonly capabilities: AgentCapability[];
  private context: HarnessContext | null = null;

  constructor() {
    this.capabilities = [
      { operation: 'chat', description: 'Conversación con IA (GLM 5.3 Flash)' },
      { operation: 'generate', description: 'Generación de contenido' },
      { operation: 'analyze', description: 'Análisis de datos/texto' },
      { operation: 'validate', description: 'Validación contra reglas del dominio' },
      { operation: 'execute-skill', description: 'Ejecutar skill del arnés' },
      { operation: 'query-knowledge', description: 'Consultar conocimiento del dominio' },
    ];
  }

  async initialize(context: HarnessContext): Promise<void> {
    this.context = context;
    const bridgeList = context.bridges.list();
    console.log(`[GeneralAdapter] Montado. Bridges: ${bridgeList.map((b: any) => b.type).join(', ')}`);
  }

  async execute(operation: string, params: Record<string, unknown>): Promise<AdapterResult> {
    if (!this.context) return { success: false, error: 'Adapter not initialized' };
    try {
      switch (operation) {
        case 'chat': case 'generate': case 'analyze': {
          const result = await this.context.bridges.execute(operation, params);
          return {
            success: result.success,
            data: result.data,
            error: result.error,
            metadata: { source: result.source },
          };
        }
        case 'validate': {
          const knowledgeResult = this.context.knowledge.get(params.knowledgeId as string);
          if (!knowledgeResult) {
            return { success: false, error: `Knowledge module not found: ${params.knowledgeId}` };
          }
          const bridgeResult = await this.context.bridges.execute('chat', {
            messages: [
              { role: 'system', content: `Usa estas reglas: ${JSON.stringify(knowledgeResult.getContent())}` },
              { role: 'user', content: `Valida: ${JSON.stringify(params.data)}` },
            ],
          });
          return {
            success: bridgeResult.success,
            data: bridgeResult.data,
            metadata: { source: bridgeResult.source },
          };
        }
        case 'execute-skill': {
          const skillResult = await this.context.skills.execute(
            params.skillId as string,
            params.operation as string,
            {
              bridges: this.context.bridges,
              knowledge: this.context.knowledge,
              agent: this,
              params: (params.params as Record<string, unknown>) || {},
            }
          );
          return {
            success: skillResult.success,
            data: skillResult.data,
            error: skillResult.error,
          };
        }
        case 'query-knowledge': {
          const module = this.context.knowledge.get(params.moduleId as string);
          if (!module) {
            return { success: false, error: `Knowledge module not found: ${params.moduleId}` };
          }
          return { success: true, data: module.getContent() };
        }
        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  canHandle(operation: string): boolean {
    return this.capabilities.some(c => c.operation === operation);
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.context) return { healthy: false, details: { error: 'Not initialized' } };
    const bridgeList = this.context.bridges.list();
    const knowledgeHealth = this.context.knowledge.healthCheck();
    return {
      healthy: bridgeList.length > 0,
      details: {
        bridges: bridgeList.length,
        knowledge: knowledgeHealth,
      },
    };
  }

  async shutdown(): Promise<void> {
    this.context = null;
    console.log('[GeneralAdapter] Desconectado del arnés');
  }
}
