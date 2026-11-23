import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/**
 * Barrido de accesibilidad (axe-core, WCAG 2 A/AA) sobre las pantallas principales de cada rol.
 * Falla ante cualquier violación «serious» o «critical» que no esté en KNOWN (con su motivo).
 * Las «moderate» y «minor» se adjuntan al informe sin romper la prueba.
 */
const PASSWORD = "Password123";

// `next dev` compila cada ruta la primera vez que se visita: se da margen al primer acceso de cada rol.
test.setTimeout(120_000);

/** Reglas con violaciones conocidas y aceptadas, por regla → motivo. Debe tender a vacío. */
const KNOWN: Record<string, string> = {};

async function login(page: Page, user: string) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle"); // hidratar antes de escribir (WebKit)
  await page.getByPlaceholder("Tu usuario").fill(user);
  await page.getByPlaceholder("••••••••").fill(PASSWORD);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function scan(page: Page, path: string, testInfo: import("@playwright/test").TestInfo) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  // WebKit tarda en terminar las transiciones CSS: axe medía colores a mitad de camino (falsos contrastes)
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  await testInfo.attach(`axe-${path.replace(/\W+/g, "_")}.json`, {
    body: JSON.stringify(results.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target, html: n.html })) })), null, 2),
    contentType: "application/json",
  });
  // A11Y_DUMP=ruta.jsonl vuelca todas las violaciones con su HTML para repasarlas sin reejecutar
  if (process.env.A11Y_DUMP) fs.appendFileSync(process.env.A11Y_DUMP, JSON.stringify({ path, violations: results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => ({ target: n.target, html: n.html, data: n.any[0]?.data })) })) }) + "\n");
  const blocking = results.violations.filter((v) => (v.impact === "serious" || v.impact === "critical") && !KNOWN[v.id]);
  expect(
    blocking.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 25).map((n) => `${n.target.join(" ")} :: ${n.html.slice(0, 160)}`).join(" ¦ ")}`),
  ).toEqual([]);
}

const PUBLIC = ["/", "/login", "/register", "/privacy", "/terms", "/forgot-password"];
const STUDENT = ["/dashboard", "/dashboard/teachers", "/dashboard/classes", "/dashboard/schedule", "/dashboard/profile", "/dashboard/materials", "/dashboard/homework"];
const TEACHER = ["/teacher/dashboard", "/teacher/profile", "/teacher/packages", "/teacher/availability", "/teacher/students", "/teacher/payments"];
const ADMIN = ["/admin/dashboard", "/admin/settings", "/admin/payments", "/admin/users", "/admin/teachers"];

test.describe("accesibilidad · público", () => {
  for (const path of PUBLIC) test(path, async ({ page }, info) => { await scan(page, path, info); });
});

test.describe("accesibilidad · alumno", () => {
  test.beforeEach(async ({ page }) => { await login(page, "alumno"); });
  for (const path of STUDENT) test(path, async ({ page }, info) => { await scan(page, path, info); });
});

test.describe("accesibilidad · profesor", () => {
  test.beforeEach(async ({ page }) => { await login(page, "profe"); });
  for (const path of TEACHER) test(path, async ({ page }, info) => { await scan(page, path, info); });
});

test.describe("accesibilidad · superadmin", () => {
  test.beforeEach(async ({ page }) => { await login(page, "admin"); });
  for (const path of ADMIN) test(path, async ({ page }, info) => { await scan(page, path, info); });
});
