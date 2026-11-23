import { test, expect, chromium } from "@playwright/test";
import lighthouse from "lighthouse";

/**
 * Lighthouse (rendimiento, accesibilidad, buenas prácticas y SEO) sobre las páginas públicas.
 * Corre solo en el proyecto `lighthouse` (Chromium con puerto de depuración) y SOLO tiene sentido contra la
 * compilación de producción (`CI=true`: `next build` + `next start`); contra `next dev` el rendimiento sale muy bajo.
 * Los umbrales son un suelo por debajo de lo medido (2026-11-23, portada, login y registro: rendimiento 1,00, accesibilidad 0,95-0,98, buenas prácticas 0,92-1,00, SEO 1,00; LCP 1,1 s, TBT 40-60 ms, CLS 0): sirven para detectar regresiones, no son una nota objetivo.
 * El informe completo de cada página se adjunta a la prueba (JSON).
 */
const PORT = 9333;
const PAGES: { path: string; min: { performance: number; accessibility: number; "best-practices": number; seo: number } }[] = [
  { path: "/", min: { performance: 0.7, accessibility: 0.9, "best-practices": 0.85, seo: 0.9 } },
  { path: "/login", min: { performance: 0.7, accessibility: 0.9, "best-practices": 0.85, seo: 0.9 } },
  { path: "/register", min: { performance: 0.7, accessibility: 0.9, "best-practices": 0.85, seo: 0.9 } },
];

test.describe("lighthouse · páginas públicas", () => {
  test.setTimeout(300_000);
  let browser: Awaited<ReturnType<typeof chromium.launch>>;

  test.beforeAll(async () => {
    browser = await chromium.launch({ args: [`--remote-debugging-port=${PORT}`] });
  });
  test.afterAll(async () => { await browser?.close(); });

  for (const { path, min } of PAGES) {
    test(path, async ({ baseURL }, info) => {
      const result = await lighthouse(
        `${baseURL}${path}`,
        { port: PORT, output: "json", logLevel: "error", onlyCategories: Object.keys(min) },
      );
      expect(result, "Lighthouse no devolvió resultado").toBeTruthy();
      const lhr = result!.lhr;
      const scores = Object.fromEntries(Object.entries(lhr.categories).map(([k, v]) => [k, v.score ?? 0]));
      await info.attach(`lighthouse-${path === "/" ? "portada" : path.slice(1)}.json`, {
        body: JSON.stringify({ scores, metrics: {
          fcp: lhr.audits["first-contentful-paint"]?.displayValue, lcp: lhr.audits["largest-contentful-paint"]?.displayValue,
          tbt: lhr.audits["total-blocking-time"]?.displayValue, cls: lhr.audits["cumulative-layout-shift"]?.displayValue,
        } }, null, 2),
        contentType: "application/json",
      });
      console.log(`LIGHTHOUSE ${path} ${JSON.stringify(scores)} LCP=${lhr.audits["largest-contentful-paint"]?.displayValue} TBT=${lhr.audits["total-blocking-time"]?.displayValue} CLS=${lhr.audits["cumulative-layout-shift"]?.displayValue}`);
      for (const [cat, floor] of Object.entries(min)) {
        expect(scores[cat], `${path}: ${cat}`).toBeGreaterThanOrEqual(floor);
      }
    });
  }
});
