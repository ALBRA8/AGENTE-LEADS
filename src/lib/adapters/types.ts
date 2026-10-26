// ============================================================
// src/lib/adapters/types.ts — AgentAdapter interface (FASE 2)
// ============================================================

export interface AgentAdapter {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly capabilities: AgentCapability[];
  initialize(context: HarnessContext): Promise<void>;
  execute(operation: string, params: Record<string, unknown>): Promise<AdapterResult>;
  canHandle(operation: string): boolean;
  healthCheck(): Promise<HealthStatus>;
  shutdown(): Promise<void>;
}

export interface HarnessContext {
  bridges: any; // BridgeRegistry (forward ref to avoid circular)
  skills: any;  // SkillRegistry
  knowledge: any; // KnowledgeRegistry
  config: ProjectConfig;
}

export interface AdapterResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentCapability {
  operation: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface HealthStatus {
  healthy: boolean;
  latency?: number;
  details?: Record<string, unknown>;
}

export interface ProjectConfig {
  projectName: string;
  stack: 'nextjs' | 'node' | 'python' | 'hybrid';
  environment: 'development' | 'production';
  bridges: BridgeConfig[];
}

export interface BridgeConfig {
  type: 'zai-sdk' | 'python' | 'http' | 'nvidia-nim';
  enabled: boolean;
  config?: Record<string, unknown>;
}
