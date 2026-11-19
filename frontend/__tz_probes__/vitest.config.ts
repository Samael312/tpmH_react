// Config propia de las sondas de zona horaria (auditoría TZ, docs/_tz_parts/4_frontend.md).
// Ejecutar: npx vitest run --config __tz_probes__/vitest.config.ts
// Cada test PASA mientras el bug descrito exista (mismo criterio que backend/tests/tenant_probes).
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "..") } },
  test: { environment: "node", include: ["__tz_probes__/**/*.probe.test.ts"], root: path.resolve(__dirname, "..") },
});
