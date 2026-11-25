import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

/**
 * E2E minimo (F10). Levanta:
 *  - el backend REAL con SQLite y datos semilla (`backend/tests/audit/run_server.py`): nunca toca una BD real;
 *  - el frontend (en local `next dev`; en CI `next build` + `next start`).
 * Cuentas semilla (contrasena Password123): admin, profe, alumno y nuevo (alumno sin onboarding).
 *
 *   npm run test:e2e
 *
 * Variables: E2E_PYTHON = interprete con las dependencias del backend. Si no se define, se usa el del entorno virtual
 * del backend (`backend/venv` o `backend/.venv`) cuando existe y, si no, `python` (es lo que hace el CI).
 */
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../backend");

function findPython(): string {
  const fromEnv = process.env.E2E_PYTHON?.trim().replace(/^["']|["']$/g, "");
  if (fromEnv) return fromEnv;
  for (const venv of ["venv", ".venv"]) {
    for (const rel of ["Scripts/python.exe", "bin/python"]) {
      const candidate = path.join(BACKEND, venv, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "python";
}
// Entre comillas: la ruta del entorno virtual puede llevar espacios (cmd.exe y sh lo admiten).
const python = `"${findPython()}"`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, // un solo backend con SQLite compartido
  workers: 1,
  retries: 1, // `next dev` compila cada ruta en frío: la primera visita puede agotar el tiempo
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Escritorio y móvil, Chromium y WebKit (Safari/iOS). Para correr uno: `npx playwright test --project=mobile-chrome`.
  projects: [
    { name: "chromium", testIgnore: /lighthouse\.spec/, use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", testIgnore: /lighthouse\.spec/, use: { ...devices["Pixel 5"] } },
    { name: "webkit", testIgnore: /lighthouse\.spec/, use: { ...devices["Desktop Safari"] } },
    { name: "mobile-safari", testIgnore: /lighthouse\.spec/, use: { ...devices["iPhone 13"] } },
    // Lighthouse: solo Chromium y solo ese spec. Mide bien contra la compilación de producción (`CI=true`).
    { name: "lighthouse", testMatch: /lighthouse\.spec/, use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: `${python} -m tests.audit.run_server 8000`,
      cwd: "../backend",
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: false, // siempre una BD semilla limpia
      timeout: 120_000,
    },
    {
      command: process.env.CI ? "npm run build && npm run start" : "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      // CSP_SKIP_UPGRADE: sin él, WebKit pide los recursos de la compilación de producción por https://localhost y falla.
      env: { NEXT_PUBLIC_API_URL: "http://localhost:8000/api/v1", CSP_SKIP_UPGRADE: "1" },
    },
  ],
});
