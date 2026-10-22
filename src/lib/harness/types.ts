// ============================================================
// src/lib/harness/types.ts — SkillRegistry + SkillPlugin (FASE 4)
// ============================================================

export type SkillCategory =
  | 'validation' | 'generation' | 'analysis'
  | 'assembly' | 'review' | 'orchestration' | 'domain-specific';

export interface ISkillPlugin {
  readonly id: string;
  readonly name: string;
  readonly category: SkillCategory;
  readonly operations: SkillOperation[];
  execute(operation: string, context: SkillContext): Promise<SkillResult>;
}

export interface SkillOperation {
  id: string;
  name: string;
  description: string;
  params?: Record<string, SkillParamDef>;
}

export interface SkillParamDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description?: string;
}

export interface SkillContext {
  bridges: any; // BridgeRegistry
  knowledge: any; // KnowledgeRegistry
  agent: any; // AgentAdapter
  params: Record<string, unknown>;
}

export interface SkillResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export class SkillRegistry {
  private skills = new Map<string, ISkillPlugin>();

  register(skill: ISkillPlugin): void {
    this.skills.set(skill.id, skill);
  }

  get(id: string): ISkillPlugin | undefined {
    return this.skills.get(id);
  }

  list(): Array<{ id: string; name: string; category: SkillCategory; operations: string[] }> {
    return Array.from(this.skills.values()).map(s => ({
      id: s.id,
      name: s.name,
      category: s.category,
      operations: s.operations.map(o => o.id),
    }));
  }

  findByCategory(category: SkillCategory): ISkillPlugin[] {
    return Array.from(this.skills.values()).filter(s => s.category === category);
  }

  async execute(skillId: string, operation: string, context: SkillContext): Promise<SkillResult> {
    const skill = this.skills.get(skillId);
    if (!skill) return { success: false, error: `Skill not found: ${skillId}` };
    if (!skill.operations.some(o => o.id === operation)) {
      return { success: false, error: `Operation ${operation} not found in skill ${skillId}` };
    }
    return skill.execute(operation, context);
  }
}
