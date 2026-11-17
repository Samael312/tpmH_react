import { defineConfig, devices } from "@playwright/test";

/**
 * E2E minimo (F10). Levanta:
 *  - el backend REAL con SQLite y datos semilla (`backend/tests/audit/run_server.py`): nunca toca una BD real;
 *  - el frontend (en local `next dev`; en CI `next build` + `next start`).
 * Cuentas semilla (contrasena Password123): admin, profe, alumno y nuevo (alumno sin onboarding).
 *
 *   npm run test:e2e
 *
 * Variables: E2E_PYTHON = interprete con las dependencias del backend (por defecto `python`;
 * el comando corre dentro de `backend/`, asi que en Windows suele ser `venv\Scripts\python.exe`).
 */
const python = process.env.E2E_PYTHON ?? "python";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, // un solo backend con SQLite compartido
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
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
      env: { NEXT_PUBLIC_API_URL: "http://localhost:8000/api/v1" },
    },
  ],
});
