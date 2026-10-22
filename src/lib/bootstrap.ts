// ============================================================
// src/lib/bootstrap.ts — Bootstrap (FASE 7)
// Initializes the harness: bridges + skills + knowledge + agent
// ============================================================

import { BridgeRegistry } from './bridges/types.js';
import { NvidiaNimBridge } from './bridges/nvidia-nim-bridge.js';
import { PythonBridge } from './bridges/python-bridge.js';
import { SkillRegistry } from './harness/types.js';
import { KnowledgeRegistry, registerBuiltinKnowledge } from './harness/knowledge-registry.js';
import { GeneralAdapter } from './adapters/general-adapter.js';
import type { AgentAdapter, HarnessContext, ProjectConfig } from './adapters/types.js';

export interface BootstrapResult {
  agent: AgentAdapter;
  bridges: BridgeRegistry;
  skills: SkillRegistry;
  knowledge: KnowledgeRegistry;
  config: ProjectConfig;
}

let _harness: BootstrapResult | null = null;

export async function bootstrap(config?: Partial<ProjectConfig>): Promise<BootstrapResult> {
  const fullConfig: ProjectConfig = {
    projectName: config?.projectName ?? 'AGENTE-LEADS',
    stack: config?.stack ?? 'node',
    environment: (process.env.NODE_ENV as 'development' | 'production') ?? 'development',
    bridges: config?.bridges ?? [
      { type: 'nvidia-nim', enabled: true },
      { type: 'python', enabled: true, config: { scriptDir: './src/agent/scripts' } },
    ],
  };

  console.log(`[Bootstrap] Inicializando arnés para: ${fullConfig.projectName}`);

  // 1. Bridges
  const bridges = new BridgeRegistry();
  const nvidiaBridge = new NvidiaNimBridge();
  bridges.register(nvidiaBridge, true); // priority bridge

  for (const bridgeConfig of fullConfig.bridges) {
    if (bridgeConfig.type === 'python' && bridgeConfig.enabled) {
      const pythonBridge = new PythonBridge(
        `${fullConfig.projectName}-python`,
        (bridgeConfig.config?.pythonPath as string) || 'python3',
        (bridgeConfig.config?.scriptDir as string) || './src/agent/scripts'
      );
      bridges.register(pythonBridge);
    }
  }

  // 2. Skills
  const skills = new SkillRegistry();
  // Skills will be registered by the project (pipelines register themselves)

  // 3. Knowledge
  const knowledge = new KnowledgeRegistry();
  registerBuiltinKnowledge(knowledge);

  // 4. Agent
  const agent = new GeneralAdapter();
  const context: HarnessContext = { bridges, skills, knowledge, config: fullConfig };
  await agent.initialize(context);

  console.log(
    `[Bootstrap] ✅ Arnés listo. Agente: ${agent.name} | ` +
    `Bridges: ${bridges.list().length} | ` +
    `Skills: ${skills.list().length} | ` +
    `Knowledge: ${knowledge.list().length}`
  );

  _harness = { agent, bridges, skills, knowledge, config: fullConfig };
  return _harness;
}

export function getHarness(): BootstrapResult | null {
  return _harness;
}

export function setHarness(h: BootstrapResult): void {
  _harness = h;
}
