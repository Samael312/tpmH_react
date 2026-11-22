import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = { "@": path.resolve(__dirname, ".") };

export default defineConfig({
  resolve: { alias },
  // Next usa "jsx": "preserve"; vitest necesita transformar el JSX de los componentes.
  esbuild: { jsx: "automatic" },
  test: {
    projects: [
      {
        // Lógica pura (lib/, store/, proxy): sin DOM.
        extends: true,
        test: { name: "unit", environment: "node", include: ["tests/**/*.test.ts"] },
      },
      {
        // Pantallas y componentes: DOM simulado + API simulada (ver tests/components/setup.ts).
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          include: ["tests/components/**/*.test.tsx"],
          setupFiles: ["tests/components/setup.ts"],
          testTimeout: 20_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["app/**/*.tsx", "components/**/*.tsx", "hooks/**/*.ts", "lib/**/*.ts", "lib/**/*.tsx", "store/**/*.ts"],
      reporter: ["text-summary", "json-summary"],
    },
  },
});
