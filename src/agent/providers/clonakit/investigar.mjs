// Investiga una app con REA y escribe un informe en lenguaje sencillo.
//
// Uso:  npm run investigar -- "<ruta de la app o URL>" --nombre <nombre-del-clon>
//
// Resultado en clones/<nombre>/investigacion/:
//   informe.md   lo que hay que leer
//   captura.png  (solo webs) cómo se ve la página
//   datos/       resultados en bruto de REA; nunca se publican

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  BUNDLED_LIBRARIES,
  ENTITLEMENTS,
  FRAMEWORKS,
  NPM_LIBRARIES,
  PLIST_PERMISSIONS,
  WEB_SERVICES,
  WEB_TECH,
  describe,
} from "./capacidades.mjs";
import { CLONES_DIR, REA_BIN, fail, findChrome, reaVersion, say, sleep, slugify } from "./comun.mjs";

const MAX_PLUGINS = 40;
const PLUGIN_CONCURRENCY = 4;

// Frameworks que casi todas las apps de Mac usan y no aportan pistas.
const NOISE_FRAMEWORKS = new Set(["Foundation", "CoreFoundation", "CoreServices", "Cocoa", "IOSurface", "ColorSync"]);
const NOISE_LIBS = /^(libSystem|libobjc|libc\+\+|libswift|dyld|libz\b|libiconv|libresolv)/;
// Piezas que usan muchas apps por pura fontanería: se listan en la tabla, pero no en los resúmenes.
const GENERIC_FRAMEWORKS = new Set([
  "AppKit", "SwiftUI", "CoreGraphics", "ImageIO", "UniformTypeIdentifiers", "DiskArbitration", "IOKit",
  "Security", "QuartzCore", "CoreText", "CoreVideo", "CoreMedia", "AudioToolbox", "AudioUnit", "OpenGL",
  "Accelerate", "SystemConfiguration", "Network", "CFNetwork", "ApplicationServices", "Carbon",
  "ServiceManagement", "Combine", "JavaScriptCore",
]);

/** «Cámara» → «cámara», pero respeta siglas y nombres propios: «GPU», «Mac». */
const lowerFirst = (text) => (/^[A-ZÁÉÍÓÚ][a-záéíóúñ]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text);

// ---------------------------------------------------------------------------
// Ejecutar REA

const elapsed = (start) => `${Math.round((Date.now() - start) / 1000)} s`;

function progressLine(text) {
  if (!process.stdout.isTTY) return;
  const width = (process.stdout.columns || 100) - 4;
  process.stdout.write(`\r\x1b[2K   ${text.slice(0, width)}`);
}

function clearProgress() {
  if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
}

/** Lanza un comando de REA, guarda su JSON en outFile y lo devuelve ya leído. */
function runRea(args, outFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [REA_BIN, ...args, "--format", "json"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = fs.createWriteStream(outFile);
    const written = new Promise((done) => out.on("finish", done));
    child.stdout.pipe(out);

    const start = Date.now();
    let lastMessage = "trabajando";
    const heartbeat = setInterval(() => progressLine(`⏳ ${elapsed(start)} · ${lastMessage}`), 1000);
    let pending = "";
    let errors = "";
    child.stderr.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        try {
          const progress = JSON.parse(line).rea_progress;
          if (progress) {
            lastMessage = progress.message;
            continue;
          }
        } catch {
          // No es una línea de progreso.
        }
        errors += `${line}\n`;
      }
    });

    child.on("error", reject);
    child.on("close", async (code) => {
      clearInterval(heartbeat);
      clearProgress();
      await written;
      let data;
      try {
        data = JSON.parse(await fsp.readFile(outFile, "utf8"));
      } catch {
        reject(new Error(errors.trim() || `REA terminó (código ${code}) sin devolver resultados`));
        return;
      }
      if (data.error) reject(new Error(data.message ?? data.error));
      else resolve(data.normalized_result ?? data);
    });
  });
}

// ---------------------------------------------------------------------------
// Qué es el objetivo

function expandHome(file) {
  return file.replace(/^~(?=$|[\\/])/, os.homedir());
}

function detectTarget(input) {
  if (/^https?:\/\//i.test(input)) {
    const url = new URL(input);
    return { kind: "web", url: url.href, label: url.hostname };
  }

  const abs = path.resolve(expandHome(input));
  if (!fs.existsSync(abs)) {
    fail(`No encuentro «${abs}».\n   Comprueba la ruta. En Mac puedes arrastrar la app desde Aplicaciones a la terminal para pegar su ruta.`);
  }
  const stat = fs.statSync(abs);

  if (stat.isFile() && abs.endsWith(".asar")) return { kind: "electron", asar: abs, label: appNameFromAsar(abs) };

  if (stat.isDirectory() && abs.endsWith(".app")) {
    const resources = path.join(abs, "Contents", "Resources");
    const label = path.basename(abs, ".app");
    if (fs.existsSync(path.join(resources, "app.asar"))) {
      return { kind: "electron", app: abs, asar: path.join(resources, "app.asar"), label };
    }
    if (fs.existsSync(path.join(resources, "app", "package.json"))) {
      return { kind: "electron", app: abs, asar: path.join(resources, "app"), label };
    }
    return { kind: "native-mac", app: abs, label };
  }

  if (stat.isDirectory()) {
    for (const asar of [path.join(abs, "resources", "app.asar"), path.join(abs, "app.asar")]) {
      if (fs.existsSync(asar)) return { kind: "electron", asar, label: path.basename(abs) };
    }
    const unpacked = path.join(abs, "resources", "app");
    if (fs.existsSync(path.join(unpacked, "package.json"))) return { kind: "electron", asar: unpacked, label: path.basename(abs) };
    if (fs.existsSync(path.join(abs, "package.json"))) return { kind: "electron", asar: abs, label: path.basename(abs) };
  }

  if (/\.exe$/i.test(abs)) {
    fail(
      "Las apps nativas de Windows (.exe) todavía no están soportadas.\n" +
        "   Si la app está hecha con Electron, busca el archivo resources\\app.asar en su carpeta de instalación y usa esa ruta.",
    );
  }
  fail(`No sé investigar «${abs}».\n   Prueba con una app de Mac (.app), un archivo app.asar o una URL que empiece por https://`);
}

/** «…/Slack/resources/app.asar» → «Slack»; «…/X.app/Contents/Resources/app.asar» → «X». */
function appNameFromAsar(asar) {
  const parts = asar.split(/[\\/]/);
  const appBundle = parts.find((part) => part.endsWith(".app"));
  if (appBundle) return appBundle.slice(0, -4);
  const resources = parts.findLastIndex((part) => part.toLowerCase() === "resources");
  return resources > 0 ? parts[resources - 1] : path.basename(asar, ".asar");
}

// ---------------------------------------------------------------------------
// Apps de Mac (nativas y Electron)

function frameworkName(dependencyPath) {
  return dependencyPath.match(/\/System\/Library\/(?:Private)?Frameworks\/([\w.]+)\.framework/)?.[1] ?? null;
}

const items = (list) => (Array.isArray(list) ? list : (list?.items ?? []));

/** Resume un Mach-O: frameworks del sistema, librerías y funciones importadas. */
function summarizeMacho(macho) {
  const frameworks = new Set();
  const libraries = new Set();
  for (const dep of items(macho?.dependencies)) {
    const file = dep.name ?? dep.path ?? "";
    const framework = frameworkName(file);
    if (framework) frameworks.add(framework);
    else {
      const base = path.basename(file).replace(/\.(dylib|framework)$/, "").replace(/\.\d+$/, "");
      if (!NOISE_LIBS.test(base)) libraries.add(base);
    }
  }

  const classes = new Map(); // framework → clases de Objective-C usadas
  const internal = new Map(); // librería propia → grupos de funciones
  for (const imp of items(macho?.imports)) {
    const name = (imp.name ?? "").replace(/^_/, "");
    const source = imp.source ?? "";
    const objcClass = name.match(/^OBJC_CLASS_\$_(\w+)/)?.[1];
    if (objcClass && FRAMEWORKS[source]) {
      if (!classes.has(source)) classes.set(source, new Set());
      classes.get(source).add(objcClass);
    } else if (!FRAMEWORKS[source] && /^[a-z][a-z0-9]*_[a-z0-9_]+$/.test(name) && !NOISE_LIBS.test(source)) {
      const group = name.split("_").slice(0, 2).join("_");
      if (!internal.has(source)) internal.set(source, new Map());
      const groups = internal.get(source);
      groups.set(group, (groups.get(group) ?? 0) + 1);
    }
  }
  return { frameworks, libraries, classes, internal };
}

function bundleExecutable(bundle) {
  const macos = path.join(bundle, "Contents", "MacOS");
  if (!fs.existsSync(macos)) return null;
  const file = fs.readdirSync(macos).find((name) => !name.startsWith("."));
  return file ? path.join(macos, file) : null;
}

async function inspectPlugins(app, dataDir) {
  const dir = path.join(app, "Contents", "PlugIns");
  if (!fs.existsSync(dir)) return { plugins: [], total: 0 };
  const bundles = fs
    .readdirSync(dir)
    .filter((name) => /\.(plugin|bundle|appex)$/.test(name))
    .sort();

  const plugins = [];
  const queue = bundles.slice(0, MAX_PLUGINS);
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const name = queue.shift();
      const executable = bundleExecutable(path.join(dir, name));
      if (!executable) continue;
      try {
        const macho = await runRea(["inspect-macho", executable], path.join(dataDir, `plugin-${slugify(name)}.json`));
        plugins.push({ name: name.replace(/\.(plugin|bundle|appex)$/, ""), ...summarizeMacho(macho) });
      } catch {
        plugins.push({ name: name.replace(/\.(plugin|bundle|appex)$/, ""), failed: true });
      }
      done++;
      progressLine(`⏳ plugins analizados: ${done}/${Math.min(bundles.length, MAX_PLUGINS)}`);
    }
  };
  await Promise.all(Array.from({ length: PLUGIN_CONCURRENCY }, worker));
  clearProgress();
  plugins.sort((a, b) => a.name.localeCompare(b.name));
  return { plugins, total: bundles.length };
}

function listBundledLibraries(app) {
  const dir = path.join(app, "Contents", "Frameworks");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => !name.startsWith(".") && !name.endsWith(".app"))
    .map((name) => name.replace(/\.(framework|dylib|so)$/, "").replace(/\.\d+$/, ""));
}

function listHelpers(app) {
  const places = [
    [path.join(app, "Contents", "Library", "LoginItems"), "se abre al iniciar sesión"],
    [path.join(app, "Contents", "Library", "SystemExtensions"), "extensión del sistema"],
    [path.join(app, "Contents", "XPCServices"), "proceso ayudante"],
    [path.join(app, "Contents", "Frameworks"), "proceso ayudante"],
  ];
  const helpers = [];
  for (const [dir, role] of places) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (/\.(app|xpc|systemextension)$/.test(name)) helpers.push([name.replace(/\.(app|xpc|systemextension)$/, ""), role]);
    }
  }
  const macos = path.join(app, "Contents", "MacOS");
  const main = bundleExecutable(app);
  if (fs.existsSync(macos)) {
    for (const name of fs.readdirSync(macos)) {
      if (path.join(macos, name) !== main && !name.startsWith(".")) helpers.push([name, "programa o librería auxiliar"]);
    }
  }
  return helpers;
}

async function inspectBundleIdentity(app, dataDir) {
  const plist = await runRea(["inspect-plist", app], path.join(dataDir, "plist.json"));
  const signature = await runRea(["inspect-signature", app], path.join(dataDir, "firma.json")).catch(() => null);
  return { plist: plist.value ?? {}, bundle: plist.bundle ?? {}, signature };
}

async function investigateNativeMac(target, dataDir) {
  say("   1/3 · Leyendo identidad y permisos…");
  const identity = await inspectBundleIdentity(target.app, dataDir);
  say("   2/3 · Analizando el programa principal…");
  const main = summarizeMacho(await runRea(["inspect-macho", target.app], path.join(dataDir, "ejecutable.json")));
  say("   3/3 · Analizando plugins y componentes…");
  const { plugins, total } = await inspectPlugins(target.app, dataDir);
  return {
    ...identity,
    main,
    plugins,
    pluginTotal: total,
    bundled: listBundledLibraries(target.app),
    helpers: listHelpers(target.app),
  };
}

/** Lee un archivo de un .asar sin dependencias: cabecera JSON + contenido a continuación. */
function readFromAsar(archive, file) {
  const fd = fs.openSync(archive, "r");
  try {
    const sizeBuffer = Buffer.alloc(8);
    fs.readSync(fd, sizeBuffer, 0, 8, 0);
    const headerSize = sizeBuffer.readUInt32LE(4);
    const headerBuffer = Buffer.alloc(headerSize);
    fs.readSync(fd, headerBuffer, 0, headerSize, 8);
    const jsonLength = headerBuffer.readUInt32LE(4);
    const header = JSON.parse(headerBuffer.toString("utf8", 8, 8 + jsonLength));
    const entry = header.files?.[file];
    if (!entry || entry.unpacked || entry.size === undefined) return null;
    const content = Buffer.alloc(entry.size);
    fs.readSync(fd, content, 0, entry.size, 8 + headerSize + Number(entry.offset));
    return content.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function readAppPackage(asar) {
  try {
    const text = fs.statSync(asar).isDirectory()
      ? fs.readFileSync(path.join(asar, "package.json"), "utf8")
      : readFromAsar(asar, "package.json");
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function investigateElectron(target, dataDir) {
  const steps = target.app ? 2 : 1;
  let identity = null;
  if (target.app) {
    say(`   1/${steps} · Leyendo identidad y permisos…`);
    identity = await inspectBundleIdentity(target.app, dataDir);
  }
  say(`   ${steps}/${steps} · Analizando el código de la app (en apps grandes tarda varios minutos)…`);
  const analysis = await runRea(
    ["analyze-javascript-application", target.asar, "--integrity-policy", "record-and-continue"],
    path.join(dataDir, "aplicacion.json"),
  );
  return { ...(identity ?? {}), pkg: readAppPackage(target.asar), analysis };
}

// ---------------------------------------------------------------------------
// Webs

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForChrome(endpoint) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${endpoint}/json/version`)).ok) return;
    } catch {
      // Chrome aún no escucha.
    }
    await sleep(300);
  }
  throw new Error("Chrome no ha arrancado a tiempo.");
}

async function investigateWeb(target, investigationDir, dataDir) {
  const chrome = findChrome();
  if (!chrome) fail("Para investigar webs necesito Google Chrome. Instálalo desde https://www.google.com/chrome/ y vuelve a probar.");

  const port = await freePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), "clonakit-chrome-"));
  say("   Se abrirá una ventana de Chrome temporal: no la toques, se cerrará sola.");
  // Perfil temporal y depuración solo en 127.0.0.1: nada de tus sesiones ni accesible desde la red.
  const browser = spawn(
    chrome,
    [
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1366,900",
      target.url,
    ],
    { stdio: "ignore" },
  );

  try {
    await waitForChrome(endpoint);
    say("   1/4 · Esperando a que la página cargue…");
    await sleep(7000);
    const { targets } = await runRea(["list-browser-targets", endpoint], path.join(dataDir, "pestanas.json"));
    const origin = new URL(target.url).origin;
    const page = targets.find((t) => t.origin === origin) ?? targets.find((t) => t.type === "page");
    if (!page) throw new Error("No encuentro la página en Chrome. ¿Pide iniciar sesión o redirige a otra web?");

    say("   2/4 · Haciendo una captura…");
    const shot = await runRea(["capture-web-screenshot", endpoint, page.target_id], path.join(dataDir, "captura.json"));
    fs.writeFileSync(path.join(investigationDir, "captura.png"), Buffer.from(shot.artifact.data_base64, "base64"));

    say("   3/4 · Leyendo la estructura de la página…");
    const pageInfo = await runRea(
      ["inspect-web-page", endpoint, page.target_id, "--observation-ms", "3000", "--include-accessibility-text", "--include-storage-keys"],
      path.join(dataDir, "pagina.json"),
    );

    say("   4/4 · Analizando los scripts que descarga…");
    const bundle = await runRea(
      ["analyze-web-bundle", endpoint, page.target_id, "--observation-ms", "3000"],
      path.join(dataDir, "scripts.json"),
    );
    return { page, pageInfo, bundle };
  } finally {
    browser.kill();
    await sleep(800);
    await fsp.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Informe en Markdown

const escapeCell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");

function table(headers, rows) {
  if (!rows.length) return "_Nada que mostrar._\n";
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ].join("\n") + "\n";
}

const bullets = (lines) => (lines.length ? lines.map((line) => `- ${line}`).join("\n") + "\n" : "_Nada que mostrar._\n");

const unique = (values) => [...new Set(values.filter(Boolean))];

const listPreview = (values, max) =>
  values.length > max ? `${values.slice(0, max).join(", ")} y ${values.length - max} más` : values.join(", ");

function permissionsSection({ plist, signature }) {
  const rows = Object.entries(PLIST_PERMISSIONS)
    .filter(([key]) => plist?.[key])
    .map(([key, label]) => [label, `«${plist[key]}»`]);
  const entitlements = Object.keys(signature?.entitlements ?? {})
    .map((key) => ENTITLEMENTS[key])
    .filter(Boolean);

  let md = "## Permisos que pide\n\n";
  md += "Lo que la app pide al sistema operativo, con la explicación que ella misma da al usuario. ";
  md += "Esa explicación es texto del original: sirve para entender la función, pero no la copies en tu versión.\n\n";
  md += table(["Permiso", "Para qué lo pide"], rows);
  if (entitlements.length) {
    md += "\nCapacidades especiales que Apple le concede (entitlements):\n\n" + bullets(unique(entitlements));
  }
  return md;
}

function frameworksRows(main, plugins) {
  const usedBy = new Map();
  const add = (framework, who) => {
    if (NOISE_FRAMEWORKS.has(framework)) return;
    if (!usedBy.has(framework)) usedBy.set(framework, new Set());
    usedBy.get(framework).add(who);
  };
  main.frameworks.forEach((f) => add(f, "app principal"));
  for (const plugin of plugins) plugin.frameworks?.forEach((f) => add(f, plugin.name));

  const known = [];
  const other = [];
  for (const [framework, who] of usedBy) {
    if (!FRAMEWORKS[framework]) {
      other.push(framework);
      continue;
    }
    const [purpose, web] = FRAMEWORKS[framework];
    const classes = [main.classes.get(framework), ...plugins.map((p) => p.classes?.get(framework))]
      .filter(Boolean)
      .flatMap((set) => [...set]);
    const where = listPreview([...who], 3);
    known.push([
      framework,
      purpose + (classes.length ? ` (usa ${listPreview(unique(classes), 3)})` : ""),
      web,
      where,
    ]);
  }
  known.sort((a, b) => a[0].localeCompare(b[0]));
  return { known, other: other.sort() };
}

function bundledSection(names, appLabel) {
  const appSlug = slugify(appLabel);
  const groups = new Map();
  for (const name of names) {
    const description =
      describe(BUNDLED_LIBRARIES, name) ??
      (slugify(name).includes(appSlug) ? "Núcleo propio de la app" : "Librería propia o de terceros");
    if (!groups.has(description)) groups.set(description, []);
    groups.get(description).push(name);
  }
  const rows = [...groups].map(([description, list]) => [listPreview(list, 4), description]);
  return "## Librerías que lleva dentro\n\n" + table(["Librería", "Para qué sirve"], rows);
}

function internalApiSection(main) {
  const lines = [];
  for (const [source, groups] of main.internal) {
    if (!source) continue;
    const top = [...groups].sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (top.reduce((sum, [, count]) => sum + count, 0) < 10) continue;
    lines.push(`**${source}**: ${top.map(([group, count]) => `\`${group}\` (${count})`).join(", ")}`);
  }
  if (!lines.length) return "";
  return (
    "## Pistas de arquitectura\n\n" +
    "Familias de funciones que el programa principal pide a sus propias librerías, con cuántas usa de cada una. " +
    "Los nombres suelen delatar los conceptos con los que está construida la app " +
    "(por ejemplo `scene` = escenas, `source` = fuentes, `output` = salidas):\n\n" +
    bullets(lines)
  );
}

function pluginsSection(plugins, total) {
  if (!plugins.length) return "";
  const rows = plugins.map((plugin) => {
    if (plugin.failed) return [plugin.name, "No se pudo analizar"];
    const uses = [...(plugin.frameworks ?? [])]
      .filter((f) => FRAMEWORKS[f] && !NOISE_FRAMEWORKS.has(f) && !GENERIC_FRAMEWORKS.has(f))
      .map((f) => lowerFirst(FRAMEWORKS[f][0]));
    return [plugin.name, uses.length ? listPreview(unique(uses), 3) : "Solo piezas genéricas"];
  });
  let md = "## Módulos y plugins\n\n";
  md += "La app está dividida en piezas que se cargan por separado. El nombre de cada plugin y lo que usa dan pistas de su función:\n\n";
  md += table(["Plugin", "Usa"], rows);
  if (total > plugins.length) md += `\n_Se muestran ${plugins.length} de ${total} plugins._\n`;
  return md;
}

function nativeReport(result) {
  const { plist, bundle, main, plugins, pluginTotal, bundled, helpers } = result;
  const { known, other } = frameworksRows(main, plugins);
  const toolkit = bundled.some((n) => n.startsWith("Qt"))
    ? "Qt (C++)"
    : main.frameworks.has("SwiftUI")
      ? "SwiftUI"
      : "AppKit (la interfaz nativa de Mac)";
  const permissions = Object.entries(PLIST_PERMISSIONS)
    .filter(([key]) => plist[key])
    .map(([, label]) => lowerFirst(label));
  const capabilities = known
    .filter(([framework]) => !GENERIC_FRAMEWORKS.has(framework))
    .map(([, purpose]) => lowerFirst(purpose.split(" (")[0]));

  const summary = [
    `Es una **app nativa de Mac** hecha con ${toolkit}.`,
    permissions.length ? `Pide permiso para: ${unique(permissions).join(", ")}.` : "No pide permisos especiales.",
    `Piezas del sistema que usa: ${listPreview(unique(capabilities), 8)}.`,
    plugins.length ? `Está dividida en ${pluginTotal} plugins.` : null,
  ].filter(Boolean);

  let md = sectionSummary(summary);
  md += "## Qué tipo de app es\n\n";
  md += `${bundle.name ?? "La app"} (versión ${bundle.short_version ?? "?"}, identificador \`${bundle.identifier ?? "?"}\`) es una app **nativa**: `;
  md += "está compilada para el procesador del Mac y habla directamente con el sistema. ";
  md += "Sin un desensamblador (Ghidra o Hopper) no podemos leer su lógica por dentro, pero tampoco hace falta: ";
  md += "para recrear sus funciones basta con saber **qué piezas usa y para qué**.\n\n";
  if (plist.LSMinimumSystemVersion) md += `Funciona en macOS ${plist.LSMinimumSystemVersion} o superior.\n\n`;
  md += permissionsSection(result) + "\n";
  md += "## Piezas del sistema que usa\n\n";
  md += "La columna central es la clave para tu versión: cómo se consigue lo mismo en una app web.\n\n";
  md += table(["Pieza", "Para qué sirve", "Cómo se hace en una web", "Quién la usa"], known);
  if (other.length) md += `\nOtras piezas del sistema: ${other.join(", ")}.\n`;
  md += "\n" + bundledSection(bundled, bundle.name ?? "") + "\n";
  md += pluginsSection(plugins, pluginTotal) + "\n";
  md += internalApiSection(main);
  if (helpers.length) md += "\n## Programas ayudantes\n\n" + table(["Nombre", "Qué es"], helpers);
  return md;
}

function cleanChannel(label) {
  const literal = label.match(/"([^"]+)"/)?.[1] ?? (label.length > 3 ? label : null);
  if (!literal) return null;
  const name = literal.replace(/^\$eipc_message\$_[\w-]+_\$_/, "");
  // Cada app usa su convención: «Grupo_$_accion», «grupo:accion», «grupo/accion» o «grupo.accion».
  for (const separator of ["_$_", ":", "/", "."]) {
    const parts = name.split(separator).filter(Boolean);
    if (parts.length > 1) return { group: parts.at(-2).replace(/^.*\./, ""), action: parts.at(-1) };
  }
  return { group: "general", action: name };
}

function electronReport(result) {
  const { analysis, pkg, plist } = result;
  const summary = analysis.summary ?? {};
  const nodes = analysis.graph?.nodes ?? [];
  const labelsOf = (kind) => nodes.filter((n) => n.kind === kind).map((n) => n.observations?.[0]?.label).filter(Boolean);

  const windows = unique(labelsOf("electron-renderer").map((l) => l.replace(/^\.?[\w.-]*\/?renderer\//, "")));
  const bridges = unique(labelsOf("context-bridge-api").filter((l) => l !== "?" && l !== "process"));
  const addons = unique(labelsOf("native-addon").map((l) => path.basename(l)));
  const channels = new Map();
  let dynamicChannels = 0;
  for (const label of labelsOf("ipc-channel")) {
    const channel = cleanChannel(label);
    if (!channel) {
      dynamicChannels++;
      continue;
    }
    if (!channels.has(channel.group)) channels.set(channel.group, new Set());
    channels.get(channel.group).add(channel.action);
  }

  const deps = Object.keys(pkg?.dependencies ?? {});
  const libraries = deps.map((dep) => [dep, describe(NPM_LIBRARIES, dep)]).filter(([, d]) => d);

  const notStarted = (analysis.limitations ?? []).filter((l) => /was not started|not started/.test(JSON.stringify(l))).length;
  const coverage = analysis.graph?.coverage?.status ?? "desconocida";

  const permissions = plist
    ? Object.entries(PLIST_PERMISSIONS).filter(([key]) => plist[key]).map(([, label]) => lowerFirst(label))
    : [];

  const summaryLines = [
    "Es una **app Electron**: por dentro es una web (HTML, CSS y JavaScript) metida en una ventana de escritorio. ¡Buena noticia: tu versión web puede parecerse mucho!",
    windows.length ? `Tiene ${windows.length} ventanas o pantallas propias.` : null,
    channels.size
      ? `Su interfaz y su «motor» se comunican por ${summary.ipc?.operations ?? "varios"} mensajes internos agrupados en ${channels.size} ${channels.size === 1 ? "área" : "áreas"}.`
      : null,
    permissions.length ? `Pide permiso para: ${unique(permissions).join(", ")}.` : null,
    libraries.length ? `Librerías destacadas: ${listPreview(unique(libraries.map(([, d]) => d.split(":")[0])), 6)}.` : null,
  ].filter(Boolean);

  let md = sectionSummary(summaryLines);
  md += "## Qué tipo de app es\n\n";
  md += `${pkg?.productName ?? pkg?.name ?? "La app"}${pkg?.version ? ` (versión ${pkg.version})` : ""} está hecha con **Electron**. `;
  md += "Tiene dos partes: la **interfaz** (lo que ves, igual que una web) y el **proceso principal** (acceso al ordenador: archivos, ventanas, menús). ";
  md += "Se hablan con mensajes internos llamados IPC.\n\n";
  if (plist) md += permissionsSection(result) + "\n";

  md += "## Ventanas y pantallas\n\n";
  md += windows.length
    ? bullets(windows.map((w) => `\`${w}\``)) + "\n"
    : "REA no ha encontrado páginas HTML propias dentro de la app: probablemente carga su interfaz desde internet o desde otra carpeta.\n\n";

  md += "## Áreas de funcionalidad (mensajes internos)\n\n";
  md += "Los nombres de los mensajes entre la interfaz y el motor revelan qué funciones tiene la app. Agrupados por área:\n\n";
  const channelRows = [...channels]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 30)
    .map(([group, actions]) => [group, listPreview([...actions], 8)]);
  md += table(["Área", "Acciones"], channelRows);
  if (dynamicChannels) md += `\n_Además hay ${dynamicChannels} mensajes con nombre calculado al vuelo, que no se pueden leer sin ejecutar la app._\n`;

  if (bridges.length) {
    md += "\n## Funciones que el motor ofrece a la interfaz\n\n";
    md += "Nombres de los «puentes» que conectan la interfaz con el ordenador:\n\n" + bullets(bridges.map((b) => `\`${b}\``));
  }
  if (libraries.length || deps.length) {
    md += "\n## Librerías que declara\n\n";
    md += table(["Librería", "Para qué sirve"], libraries);
    const rest = deps.filter((d) => !libraries.some(([name]) => name === d));
    if (rest.length) md += `\nOtras: ${listPreview(rest, 25)}.\n`;
  }
  if (addons.length) {
    md += "\n## Módulos nativos\n\n";
    md += "Partes escritas en C, C++ o Swift para cosas que una web no puede hacer:\n\n" + bullets(addons.map((a) => `\`${a}\``));
  }
  md += "\n## Cobertura del análisis\n\n";
  md += `Cobertura: **${coverage === "complete" ? "completa" : coverage === "partial" ? "parcial" : coverage}**. `;
  if (notStarted) {
    md += `REA analizó la estructura de todos los archivos, pero en ${notStarted} no le dio tiempo a entrar en detalle. `;
    md += "Es normal en apps grandes y no impide escribir tu ficha.\n";
  } else md += "\n";
  return md;
}

function accessibleName(node) {
  const name = node.name;
  const text = typeof name === "string" ? name : (name?.value ?? name?.text ?? null);
  return text && String(text).trim() ? String(text).trim() : null;
}

function webReport(result, target) {
  const { page, pageInfo, bundle } = result;
  const ax = pageInfo.accessibility?.nodes ?? [];
  const named = (role) => unique(ax.filter((n) => n.role === role).map(accessibleName));
  const count = (role) => ax.filter((n) => n.role === role).length;
  const domCount = (tag) => (pageInfo.dom?.nodes ?? []).filter((n) => n.node_name === tag).length;

  const tech = unique((bundle.inferences ?? []).map((i) => i.value));
  const pageHost = new URL(page.url).hostname;
  const urls = [
    ...(bundle.observations?.endpoints ?? []).map((e) => e.value),
    ...(pageInfo.scripts?.items ?? []).map((s) => s.url),
    ...(pageInfo.resources ?? []).map((r) => r.url),
    ...(pageInfo.network?.requests ?? []).map((r) => r.url),
  ].filter((u) => /^https?:\/\//.test(u ?? ""));
  const hosts = unique(urls.map((u) => new URL(u).hostname)).filter((h) => h !== pageHost);
  const services = hosts.map((host) => [host, describe(WEB_SERVICES, host) ?? "Servicio externo"]);

  const storage = pageInfo.storage ?? {};
  const storageNames = [
    ...(storage.local_storage_keys ?? []).map((k) => `localStorage: \`${k.key ?? k.name ?? k}\``),
    ...(storage.indexed_db_names ?? []).map((n) => `IndexedDB: \`${n.name ?? n}\``),
    ...(storage.cache_names ?? []).map((n) => `Caché: \`${n.name ?? n}\``),
  ];
  const scripts = pageInfo.scripts?.items ?? [];
  const scriptKb = Math.round(scripts.reduce((sum, s) => sum + (s.length ?? 0), 0) / 1024);

  const elements = [
    ["Botones", count("button"), named("button")],
    ["Enlaces", count("link"), named("link")],
    ["Títulos", count("heading"), named("heading")],
    ["Campos de texto", count("textbox") + count("searchbox"), [...named("textbox"), ...named("searchbox")]],
    ["Desplegables", count("combobox"), named("combobox")],
    ["Casillas", count("checkbox") + count("switch"), [...named("checkbox"), ...named("switch")]],
    ["Deslizadores", count("slider"), named("slider")],
    ["Pestañas", count("tab"), named("tab")],
    ["Imágenes", count("image") + count("img"), []],
  ]
    .filter(([, n]) => n > 0)
    .map(([label, n, names]) => [label, n, names.length ? listPreview(names, 10) : "—"]);

  const special = [
    domCount("CANVAS") ? `Usa **${domCount("CANVAS")} lienzo(s) \`<canvas>\`**: dibuja gráficos por código (típico de editores, pizarras y juegos).` : null,
    domCount("VIDEO") ? `Tiene **${domCount("VIDEO")} vídeo(s)**.` : null,
    domCount("IFRAME") ? `Incrusta **${domCount("IFRAME")} iframe(s)** (otras webs dentro de la página).` : null,
    domCount("FORM") ? `Tiene **${domCount("FORM")} formulario(s)**.` : null,
  ].filter(Boolean);

  const summaryLines = [
    `Es una **web**${tech.length ? ` hecha con ${tech.join(" + ")}` : ""}.`,
    elements.length ? `En la pantalla inicial hay ${elements.map(([label, n]) => `${n} ${label.toLowerCase()}`).join(", ")}.` : null,
    ...special,
    services.length ? `Se conecta a ${services.length} servicios externos.` : "No se ha visto conexión con servicios externos.",
  ].filter(Boolean);

  let md = sectionSummary(summaryLines);
  md += `## Cómo se ve\n\n![Captura de ${escapeCell(page.title)}](captura.png)\n\n`;
  md += `Título: **${page.title || "(sin título)"}** · Dirección final: ${page.url}\n\n`;
  if (page.url.replace(/\/$/, "") !== target.url.replace(/\/$/, "")) md += `_La dirección pedida (${target.url}) redirigió a esta._\n\n`;

  md += "## Con qué está hecha\n\n";
  md += bullets(tech.map((t) => WEB_TECH[t] ?? t)) || "";
  md += `\nDescarga ${scripts.length} archivos de JavaScript (unos ${scriptKb} KB).\n\n`;

  md += "## Elementos de la interfaz\n\n";
  md += "Lo que hay en la primera pantalla, según el árbol de accesibilidad (lo que leería un lector de pantalla). ";
  md += "Los textos son del original: úsalos para entender la función, no los copies.\n\n";
  md += table(["Elemento", "Cuántos", "Ejemplos"], elements);
  if (special.length) md += "\n" + bullets(special);

  const routes = unique((bundle.observations?.routes ?? []).map((r) => r.value));
  if (routes.length > 1) md += "\n## Páginas internas (rutas)\n\n" + bullets(routes.map((r) => `\`${r}\``));

  md += "\n## Servicios externos\n\n" + table(["Dominio", "Qué parece ser"], services);
  if (storageNames.length) {
    md += "\n## Qué guarda en tu navegador\n\nSolo nombres, sin valores:\n\n" + bullets(storageNames.slice(0, 20));
  }
  return md;
}

function sectionSummary(lines) {
  return "## Resumen en 30 segundos\n\n" + bullets(lines) + "\n";
}

function header(target, kindLabel) {
  const date = new Date().toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" });
  const shown = target.url ?? target.app ?? target.asar;
  return (
    `# Informe de investigación: ${target.label}\n\n` +
    `> Generado por ClonaKit con REA ${reaVersion() ?? "?"} el ${date}.\n` +
    `> Objetivo: \`${shown}\` · Tipo: **${kindLabel}**\n\n` +
    "Este informe resume **cómo está montada** la app para que puedas diseñar tu propia versión. " +
    "Úsalo para entender, no para copiar: en tu `FICHA.md` describe las funciones con tus palabras, " +
    "sin copiar textos, nombres, imágenes ni código del original.\n\n"
  );
}

function footer(kind) {
  const blind = {
    "native-mac": [
      "El código por dentro: sin Ghidra o Hopper solo vemos el «esqueleto» (piezas, permisos, plugins).",
      "Lo que pasa en sus servidores, si los tiene.",
      "Cómo se ve: ábrela y fíjate en sus pantallas, o haz capturas para ti.",
    ],
    electron: [
      "Mensajes con nombres calculados al vuelo y lo que pasa en sus servidores.",
      "Cómo se ve: ábrela y fíjate en sus pantallas, o haz capturas para ti.",
      "Si la cobertura es parcial, algunos archivos solo se miraron por encima.",
    ],
    web: [
      "Lo que pasa en su servidor (bases de datos, usuarios, lógica privada): solo vemos lo que llega al navegador.",
      "Pantallas a las que se llega tras iniciar sesión o hacer clic: solo se ha mirado la página inicial.",
    ],
  }[kind];
  return (
    "\n## Lo que este informe no puede ver\n\n" +
    bullets(blind) +
    "\n## Siguiente paso\n\n" +
    "Escribe tu `FICHA.md`: elige de 3 a 5 funciones para tu primera versión y descríbelas con tus palabras. " +
    "En Claude Code, `/clonar` te guía. Los datos en bruto de `datos/` son solo para consulta: **no los publiques**.\n"
  );
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { target: null, name: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--nombre") args.name = argv[++i];
    else if (["--ayuda", "--help", "-h"].includes(argv[i])) args.help = true;
    else if (!args.target) args.target = argv[i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.target) {
    say('Uso: npm run investigar -- "<ruta de la app o URL>" --nombre <nombre-del-clon>');
    say("");
    say("Ejemplos:");
    say('  npm run investigar -- "/Applications/OBS.app" --nombre mi-estudio');
    say('  npm run investigar -- "https://excalidraw.com" --nombre mi-pizarra');
    process.exit(args.help ? 0 : 1);
  }
  if (!fs.existsSync(REA_BIN)) fail("Falta REA. Ejecuta primero: npm install");

  const target = detectTarget(args.target);
  const name = slugify(args.name ?? target.label);
  const investigationDir = path.join(CLONES_DIR, name, "investigacion");
  const dataDir = path.join(investigationDir, "datos");
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(
    path.join(dataDir, "LEEME.txt"),
    "Resultados en bruto de REA. Contienen datos de la app original: son solo para consultar y nunca se publican.\n",
  );

  const kindLabel = { "native-mac": "app nativa de Mac", electron: "app Electron", web: "web" }[target.kind];
  say(`\n🔎 Investigando «${target.label}» (${kindLabel}) para el clon «${name}»…`);
  const start = Date.now();

  let body;
  try {
    if (target.kind === "native-mac") body = nativeReport(await investigateNativeMac(target, dataDir));
    else if (target.kind === "electron") body = electronReport(await investigateElectron(target, dataDir));
    else body = webReport(await investigateWeb(target, investigationDir, dataDir), target);
  } catch (err) {
    fail(`La investigación no ha podido terminar: ${err.message}`);
  }

  const reportPath = path.join(investigationDir, "informe.md");
  await fsp.writeFile(reportPath, header(target, kindLabel) + body + footer(target.kind === "native-mac" ? "native-mac" : target.kind));
  say(`\n✅ Listo en ${elapsed(start)}. Informe: ${path.relative(process.cwd(), reportPath)}`);
  say("   Siguiente paso: léelo y escribe tu FICHA.md (en Claude Code, /clonar te guía).\n");
}

main();
