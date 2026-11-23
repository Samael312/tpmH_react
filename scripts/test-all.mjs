#!/usr/bin/env node
/**
 * Ejecución conjunta de TODAS las suites (docs/PLAN_SUITE_COMPLETA.md §4). Sin dependencias: solo Node.
 *
 *   node scripts/test-all.mjs                 # unitarias en paralelo y luego E2E
 *   node scripts/test-all.mjs --unit          # solo unitarias (backend + Vitest + sondas de zonas horarias)
 *   node scripts/test-all.mjs --e2e           # solo Playwright
 *   node scripts/test-all.mjs --cov           # con cobertura y umbrales (backend 95 %, frontend 97/90/92)
 *   node scripts/test-all.mjs --e2e-projects chromium,mobile-chrome   # subconjunto de Playwright
 *
 * Tramos 1-3 corren a la vez (no comparten estado: SQLite temporal propia, jsdom, node). El E2E va DESPUÉS
 * porque usa los puertos 8000 y 3000. Código de salida != 0 si falla cualquiera.
 * SEGURIDAD: jamás lanza `tests/flow` ni `tests/load` (los .env apuntan a la BD real). Solo `tests/audit`.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = join(ROOT, "backend");
const FRONTEND = join(ROOT, "frontend");
const WIN = process.platform === "win32";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const onlyUnit = flag("--unit");
const onlyE2e = flag("--e2e");
const cov = flag("--cov");
const e2eProjects = (value("--e2e-projects") ?? "chromium,mobile-chrome,webkit,mobile-safari").split(",").filter(Boolean);

function backendPython() {
  if (process.env.E2E_PYTHON) return process.env.E2E_PYTHON;
  if (process.env.PYTHON) return process.env.PYTHON;
  const venv = WIN ? join(BACKEND, "venv", "Scripts", "python.exe") : join(BACKEND, "venv", "bin", "python");
  return existsSync(venv) ? venv : "python";
}
const PY = backendPython();
const NPX = WIN ? "npx.cmd" : "npx";

/** Ejecuta un tramo; vuelca la salida con prefijo para que el paralelo sea legible. */
function run(name, cmd, cmdArgs, cwd, env = {}) {
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(cmd, cmdArgs, { cwd, env: { ...process.env, ...env }, shell: WIN && cmd.endsWith(".cmd") });
    const tag = `[${name}] `;
    const pipe = (stream, out) => {
      let buf = "";
      stream.on("data", (d) => {
        buf += d.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const l of lines) if (l.trim()) out.write(tag + l + "\n");
      });
      stream.on("end", () => buf.trim() && out.write(tag + buf + "\n"));
    };
    pipe(p.stdout, process.stdout);
    pipe(p.stderr, process.stderr);
    p.on("error", (e) => { console.error(`${tag}no se pudo lanzar: ${e.message}`); res({ name, code: 127, secs: 0 }); });
    p.on("close", (code) => res({ name, code: code ?? 1, secs: Math.round((Date.now() - t0) / 1000) }));
  });
}

const backendArgs = ["-m", "pytest", "tests/audit", "-q", "--ignore=tests/audit/concurrency_live.py", "-p", "no:cacheprovider"];
if (cov) backendArgs.push("--cov=app", "--cov-fail-under=95", "--cov-report=term:skip-covered");

const vitestArgs = ["vitest", "run", "--maxWorkers=3"];
if (cov) vitestArgs.push("--coverage", "--coverage.thresholds.lines=97", "--coverage.thresholds.functions=90", "--coverage.thresholds.branches=92");

const results = [];

if (!onlyE2e) {
  console.log("== Tramos unitarios en paralelo: backend, Vitest, sondas de zonas horarias ==");
  results.push(...(await Promise.all([
    run("backend", PY, backendArgs, BACKEND),
    run("vitest", NPX, vitestArgs, FRONTEND),
    run("tz", NPX, ["vitest", "run", "--config", "__tz_probes__/vitest.config.ts"], FRONTEND),
  ])));
}

if (!onlyUnit) {
  const unitFailed = results.some((r) => r.code !== 0);
  if (unitFailed && !flag("--e2e-anyway")) {
    console.log("\n== E2E omitido: fallaron tramos unitarios (usa --e2e-anyway para lanzarlo igual) ==");
  } else {
    console.log("\n== E2E (Playwright, backend semilla SQLite + frontend) ==");
    const pw = ["playwright", "test", ...e2eProjects.map((p) => `--project=${p}`)];
    results.push(await run("e2e", NPX, pw, FRONTEND, { E2E_PYTHON: PY }));
  }
}

console.log("\n== Resumen ==");
for (const r of results) console.log(`${r.code === 0 ? "OK   " : "FALLA"} ${r.name.padEnd(8)} ${r.secs}s (código ${r.code})`);
const failed = results.some((r) => r.code !== 0) || (!onlyUnit && !results.some((r) => r.name === "e2e") && !onlyE2e);
process.exit(failed ? 1 : 0);
