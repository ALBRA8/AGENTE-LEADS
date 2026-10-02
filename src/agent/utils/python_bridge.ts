import { execFile } from 'child_process';
import path from 'path';

export interface PythonBridgeResult {
  success?: boolean;
  result?: any;
  error?: string;
}

export async function runStealthScraper(url: string, selector?: string, adaptive?: boolean): Promise<PythonBridgeResult> {
  return new Promise((resolve) => {
    // Definir rutas relativas al proyecto
    const isWindows = process.platform === 'win32';
    const pythonExe = path.resolve(process.cwd(), '.venv', isWindows ? 'Scripts' : 'bin', 'python');
    const scriptPath = path.resolve(process.cwd(), 'src', 'agent', 'scripts', 'stealth_scraper.py');
    
    const args = ['--url', url];
    if (selector) {
      args.push('--selector', selector);
      if (adaptive) {
        args.push('--adaptive');
      }
    }

    console.log(`[PythonBridge] Executing stealth scraper for: ${url}`);
    
    execFile(pythonExe, [scriptPath, ...args], { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (stdout) {
        try {
          // Buscamos la primera línea que parezca JSON
          const lines = stdout.trim().split('\n');
          // Start from bottom up since JSON is usually printed last
          const jsonLine = lines.reverse().find(l => l.startsWith('{'));
          
          if (jsonLine) {
            const data = JSON.parse(jsonLine);
            return resolve(data);
          }
        } catch (e) {
          console.error(`[PythonBridge] Failed to parse output: ${(e as Error).message}\nStdout: ${stdout.substring(0, 500)}`);
          return resolve({ success: false, error: "Failed to parse Python output" });
        }
      }
      
      if (error || stderr) {
         const errMsg = (error?.message || '') + ' | ' + stderr;
         console.error(`[PythonBridge] Error running script: ${errMsg}`);
         return resolve({ success: false, error: errMsg });
      }
      
      resolve({ success: false, error: "Unknown error occurred" });
    });
  });
}
