import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * Flujos largos de punta a punta con el backend semilla (SQLite temporal):
 *  alumno nuevo → elige profesor → clase de prueba → el profesor la completa → compra el paquete por transferencia →
 *  el superadmin aprueba el pago → el alumno agenda una clase → la reagenda → el profesor pide un retiro y el
 *  superadmin lo marca como pagado.
 * Cada proyecto (escritorio, móvil, WebKit, iPhone) crea su propio alumno, así que no se pisan entre sí.
 * `/__e2e__/...` son ganchos que solo existen en el servidor semilla (nunca en producción).
 */
const API = "http://localhost:8000/api/v1";
const HOOK = "http://localhost:8000/__e2e__";
const PASSWORD = "Password123";

async function login(page: Page, user: string) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle"); // hidratar antes de escribir (WebKit)
  await page.getByPlaceholder("Tu usuario").fill(user);
  await page.getByPlaceholder("••••••••").fill(PASSWORD);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function auth(request: APIRequestContext, user: string) {
  const res = await request.post(`${API}/auth/login`, { data: { login: user, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  return { Authorization: `Bearer ${(await res.json()).access_token}` };
}

/** Elige en el calendario de agendar el día de mañana (cambia de mes si hace falta) y devuelve la hora del hueco elegido. */
async function pickTomorrowSlot(page: Page, which: "first" | "last") {
  const { day, nextMonth } = await page.evaluate(() => {
    const now = new Date();
    const t = new Date(now.getTime() + 86_400_000);
    return { day: t.getDate(), nextMonth: t.getMonth() !== now.getMonth() };
  });
  if (nextMonth) await page.getByRole("button", { name: "Mes siguiente" }).click();
  await page.locator("button:not([disabled])").filter({ hasText: new RegExp(`^${day}$`) }).first().click();
  const slots = page.locator("button:not([disabled])").filter({ hasText: /hasta/ });
  await expect(slots.first()).toBeVisible();
  const slot = which === "first" ? slots.first() : slots.last();
  const label = (await slot.innerText()).replace(/\s+/g, " ");
  await slot.click();
  return label;
}

test.describe.serial("flujo largo · alumno nuevo hasta clase reagendada y retiro del profesor", () => {
  test.setTimeout(240_000);
  let student = "";

  test.beforeAll(async ({ request }, info) => {
    student = `flow${Date.now() % 1_000_000}${info.project.name.replace(/[^a-z]/g, "")}`;
    const res = await request.post(`${HOOK}/student/${student}`);
    expect(res.ok()).toBeTruthy();
  });

  test("1 · elige profesor y reserva la clase de prueba", async ({ page }) => {
    await login(page, student);
    await page.goto("/dashboard/teachers/profe");
    await page.getByRole("button", { name: "Elegir este profesor" }).click();
    await expect(page.getByRole("button", { name: /Ya es tu profesor/ })).toBeVisible();

    await page.getByRole("button", { name: /Agendar clase de prueba/ }).click();
    await expect(page.getByRole("heading", { name: "Reserva tu clase de prueba" })).toBeVisible();
    await pickTomorrowSlot(page, "first");
    await page.getByRole("button", { name: /Confirmar clase de prueba/ }).click();
    await expect(page.getByText("¡Prueba reservada!")).toBeVisible();

    // la reserva queda en «Clase de prueba pendiente»
    await page.goto("/dashboard/schedule");
    await expect(page.getByRole("heading", { name: "Clase de prueba pendiente", exact: true })).toBeVisible();
  });

  test("2 · el profesor completa la prueba y el alumno ve los paquetes", async ({ page, request }) => {
    const teacher = await auth(request, "profe");
    const list = await request.get(`${API}/classes/teacher/classes?include_history=true`, { headers: teacher });
    expect(list.ok()).toBeTruthy();
    // el alumno se identifica por su nombre (se crea como «<usuario> E2E»)
    const mine = (await list.json()).classes.find((c: { student_name?: string }) => (c.student_name ?? "").toLowerCase().startsWith(student.toLowerCase()));
    expect(mine, "la clase de prueba del alumno no aparece al profesor").toBeTruthy();

    expect((await request.patch(`${API}/classes/${mine.id}/status`, { headers: teacher, data: { status: "confirmed" } })).ok()).toBeTruthy();
    expect((await request.post(`${HOOK}/age-class/${mine.id}`)).ok()).toBeTruthy();
    const done = await request.patch(`${API}/classes/${mine.id}/status`, { headers: teacher, data: { status: "completed" } });
    expect(done.ok(), await done.text()).toBeTruthy();

    await login(page, student);
    await page.goto("/dashboard/schedule");
    await expect(page.getByRole("heading", { name: "Elige tu paquete", exact: true })).toBeVisible();
    await expect(page.getByText("Paquete 4").first()).toBeVisible();
  });

  test("3 · compra el paquete por transferencia y queda pendiente de aprobación", async ({ page }) => {
    await login(page, student);
    await page.goto("/dashboard/schedule");
    await page.getByRole("button", { name: "Elegir este paquete" }).first().click();
    await expect(page.getByRole("heading", { name: "Completar pago" })).toBeVisible();
    await page.getByRole("button", { name: /Transferencia bancaria/ }).first().click(); // método con el que pagó
    await page.getByRole("button", { name: /Transferencia bancaria/ }).last().click(); // despliega los datos
    await expect(page.getByText("Banco AUDIT 000-123")).toBeVisible();
    await page.getByPlaceholder("Ej: últimos 4 dígitos...").fill("E2E-REF-1");
    await page.getByRole("button", { name: "Ya realicé el pago" }).click();
    await expect(page.getByRole("heading", { name: "Pago pendiente de confirmación", exact: true })).toBeVisible();
  });

  test("4 · el superadmin aprueba el pago", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admin/payments");
    const row = page.locator("div").filter({ hasText: new RegExp(student, "i") }).filter({ has: page.getByRole("button", { name: "Confirmar pago" }) }).last();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Confirmar pago" }).click();
    await page.getByRole("button", { name: "Aprobar pago" }).click();
    await expect(page.getByText(new RegExp(student, "i"))).toHaveCount(0);
  });

  test("5 · el alumno agenda una clase y la reagenda", async ({ page }) => {
    await login(page, student);
    await page.goto("/dashboard/schedule");
    await expect(page.getByRole("heading", { name: "Agendar Clase", exact: true })).toBeVisible();
    await pickTomorrowSlot(page, "last");
    await page.getByRole("button", { name: /Reservar/ }).click();
    await expect(page.getByText("¡Clase confirmada!")).toBeVisible();

    await page.goto("/dashboard/classes");
    await expect(page.getByText("Próximas (1)")).toBeVisible();
    // en móvil las acciones van dentro de un menú «Acciones»; en escritorio «Reagendar» está a la vista
    await expect(page.getByRole("button", { name: /Acciones|Reagendar/ }).first()).toBeVisible();
    const actions = page.getByRole("button", { name: /Acciones/ }).first();
    if (await actions.count()) {
      // el menú se cierra con cualquier scroll: se coloca el botón a la vista antes de abrirlo
      await actions.scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await actions.click();
    }
    await page.getByRole("button", { name: /Reagendar/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const dayAfter = await page.evaluate(() => {
      const t = new Date(Date.now() + 2 * 86_400_000);
      return t.getDate();
    });
    await dialog.getByRole("button", { name: new RegExp(`^${dayAfter} de `) }).click();
    await dialog.locator("button:not([disabled])").filter({ hasText: /^\d{1,2}:\d{2}/ }).first().click();
    await expect(dialog.getByText("Nuevo horario seleccionado")).toBeVisible();
    await dialog.getByRole("button", { name: "Confirmar reagendamiento" }).click();
    await expect(page.getByText("Clase reagendada correctamente")).toBeVisible();
  });

  test("6 · el profesor pide un retiro y el superadmin lo marca como pagado", async ({ page }) => {
    await login(page, "profe");
    await page.goto("/teacher/wallet");
    const request = page.getByRole("button", { name: "Solicitar Retiro" });
    await expect(request, "el profesor no tiene saldo disponible tras el pago aprobado").toBeEnabled();
    await request.click();
    await page.getByRole("button", { name: "Usar máximo" }).click();
    await page.locator("textarea").fill("Banco E2E · Profe Audit · 000-111");
    await page.getByRole("button", { name: "Confirmar solicitud" }).click();
    await expect(page.getByText("Solicitud de retiro enviada correctamente")).toBeVisible();

    await page.context().clearCookies();
    await login(page, "admin");
    await page.goto("/admin/payments");
    await page.getByRole("button", { name: /^Retiros/ }).click();
    await page.getByRole("button", { name: "Marcar Pagado" }).first().click();
    await page.getByPlaceholder("Nº de operación, hash, etc.").fill("E2E-WD-1");
    await page.getByRole("button", { name: "Confirmar pago" }).click();
    await expect(page.getByText("No hay solicitudes de retiro pendientes")).toBeVisible();
  });
});
