// ============================================================
// src/lib/bridges/python-bridge.ts — Python bridge (FASE 3)
// Wraps child_process execFile for scrapling/scraping scripts.
// ============================================================

import { IBridge, BridgeResult, BridgeHealth } from './types.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { assertPublicUrl } from '../../agent/core/ssrf_guard.js';

const execAsync = promisify(execFile);

export class PythonBridge implements IBridge {
  readonly type = 'python';
  readonly name: string;
  private pythonPath: string;
  private scriptDir: string;

  constructor(name = 'Python Bridge', pythonPath = 'python3', scriptDir = './src/agent/scripts') {
    this.name = name;
    this.pythonPath = pythonPath;
    this.scriptDir = scriptDir;
  }

  async isAvailable(): Promise<boolean> {
    const isWindows = process.platform === 'win32';
    const venvPython = path.resolve(process.cwd(), '.venv', isWindows ? 'Scripts' : 'bin', 'python');
    if (fs.existsSync(venvPython)) {
      this.pythonPath = venvPython;
    }
    try {
      await execAsync(`${this.pythonPath} --version`);
      return true;
    } catch {
      return false;
    }
  }

  async execute(operation: string, params: Record<string, unknown>): Promise<BridgeResult> {
    // SSRF guard for URL params
    if (params.url) {
      const urlCheck = assertPublicUrl(params.url as string);
      if (!urlCheck.ok) return { success: false, error: `SSRF: ${urlCheck.error.message}`, source: this.type };
    }

    try {
      const scriptPath = path.resolve(this.scriptDir, `${operation}.py`);
      if (!fs.existsSync(scriptPath)) {
        return { success: false, error: `Script not found: ${scriptPath}`, source: this.type };
      }

      const args: string[] = [];
      for (const [key, value] of Object.entries(params)) {
        args.push(`--${key}`, String(value));
      }

      const { stdout } = await execAsync(this.pythonPath, [scriptPath, ...args], {
        timeout: 60_000,
        maxBuffer: 1024 * 1024 * 10,
      });

      // Parse JSON from stdout (find last JSON line)
      const lines = stdout.trim().split('\n');
      const jsonLine = lines.reverse().find(l => l.startsWith('{'));
      if (jsonLine) {
        const data = JSON.parse(jsonLine);
        return { success: true, data, source: this.type };
      }
      return { success: true, data: stdout, source: this.type };
    } catch (error: any) {
      return { success: false, error: error.message, source: this.type };
    }
  }

  async healthCheck(): Promise<BridgeHealth> {
    const available = await this.isAvailable();
    return {
      available,
      details: { type: this.type, python: this.pythonPath, scriptDir: this.scriptDir },
    };
  }
}
