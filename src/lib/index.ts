// ============================================================
// src/lib/index.ts — Barrel exports for the harness
// ============================================================

export * from './adapters/types.js';
export { GeneralAdapter } from './adapters/general-adapter.js';

export * from './bridges/types.js';
export { NvidiaNimBridge } from './bridges/nvidia-nim-bridge.js';
export { PythonBridge } from './bridges/python-bridge.js';

export * from './harness/types.js';
export { KnowledgeRegistry, registerBuiltinKnowledge } from './harness/knowledge-registry.js';
export type { IKnowledgeModule } from './harness/knowledge-registry.js';

export { bootstrap, getHarness, setHarness } from './bootstrap.js';
export type { BootstrapResult } from './bootstrap.js';
