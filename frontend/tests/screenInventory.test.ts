/**
 * Inventario de pantallas: cada `app/**\/page.tsx` debe estar importado por al menos una prueba de componentes.
 * Si se añade una pantalla nueva sin prueba, este test falla y obliga a escribirla.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "app");
const TESTS = path.join(ROOT, "tests", "components");

/** Pantallas sin prueba a propósito (con el motivo). Vacío: no debe crecer sin justificarlo. */
const EXEMPT: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "page.tsx") out.push(p);
  }
  return out;
}

const norm = (s: string) => s.replace(/\\/g, "/");
const pages = walk(APP).map((p) => norm(path.relative(ROOT, p)).replace(/\.tsx$/, ""));
const testSources = fs.readdirSync(TESTS).filter((f) => f.endsWith(".tsx")).map((f) => norm(fs.readFileSync(path.join(TESTS, f), "utf8")));

describe("inventario de pantallas", () => {
  it("encuentra las pantallas de la aplicación", () => {
    expect(pages.length).toBeGreaterThan(50);
  });

  it.each(pages)("%s tiene prueba", (page) => {
    if (EXEMPT[page]) return;
    const pattern = new RegExp(`from\\s+["'](?:@/|(?:\\.\\./)+)${page.replace(/[()[\]]/g, "\\$&")}["']`);
    expect(testSources.some((src) => pattern.test(src)), `ninguna prueba importa ${page}`).toBe(true);
  });

  it("las exenciones siguen siendo pantallas reales", () => {
    for (const p of Object.keys(EXEMPT)) expect(pages).toContain(p);
  });
});
