// Utilidades compartidas por las herramientas de ClonaKit.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CLONES_DIR = path.join(KIT_ROOT, "clones");
export const REA_DIR = path.join(KIT_ROOT, "node_modules", "rea-agents");
export const REA_BIN = path.join(REA_DIR, "scripts", "rea.mjs");

export const say = (message = "") => console.log(message);

export function fail(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Nombre apto para carpetas y URLs: «Mi App Ñ» → «mi-app-n». */
export function slugify(text) {
  const slug = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "mi-clon";
}

export function reaVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(REA_DIR, "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

/** Ruta del ejecutable de Google Chrome (o Chromium), o null si no está instalado. */
export function findChrome() {
  const candidates = {
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ],
    win32: [
      path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
    ],
  }[process.platform];

  if (candidates) return candidates.find((file) => fs.existsSync(file)) ?? null;

  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" });
    if (found.status === 0) return found.stdout.trim();
  }
  return null;
}

/** Ejecuta un comando y devuelve su salida, o null si no existe o falla. */
export function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: process.platform === "win32" });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Abre una URL, un archivo o una carpeta con la app predeterminada del sistema. */
export function openWithSystem(target) {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", target]]
        : ["xdg-open", [target]];
  spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}
