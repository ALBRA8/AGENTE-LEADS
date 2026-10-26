// ============================================================
// src/lib/bridges/types.ts — Bridge interfaces (FASE 3)
// ============================================================

export interface IBridge {
  readonly type: string;
  readonly name: string;
  isAvailable(): Promise<boolean>;
  execute(operation: string, params: Record<string, unknown>): Promise<BridgeResult>;
  healthCheck(): Promise<BridgeHealth>;
}

export interface BridgeResult {
  success: boolean;
  data?: unknown;
  error?: string;
  source: string;
}

export interface BridgeHealth {
  available: boolean;
  latency?: number;
  details?: Record<string, unknown>;
}

export class BridgeRegistry {
  private bridges = new Map<string, IBridge>();
  private priority: string[] = [];

  register(bridge: IBridge, isPriority = false): void {
    this.bridges.set(bridge.type, bridge);
    if (isPriority) {
      this.priority = [bridge.type, ...this.priority.filter(t => t !== bridge.type)];
    }
  }

  async execute(operation: string, params: Record<string, unknown>): Promise<BridgeResult> {
    const order = [
      ...this.priority,
      ...Array.from(this.bridges.keys()).filter(k => !this.priority.includes(k)),
    ];
    for (const type of order) {
      const bridge = this.bridges.get(type);
      if (!bridge) continue;
      const available = await bridge.isAvailable();
      if (!available) continue;
      try {
        const result = await bridge.execute(operation, params);
        if (result.success) return result;
      } catch { continue; }
    }
    return { success: false, error: 'No bridge available', source: 'none' };
  }

  list(): Array<{ type: string; name: string }> {
    return Array.from(this.bridges.entries()).map(([type, b]) => ({ type, name: b.name }));
  }
}
