import { test, expect, type Page } from "@playwright/test";

/**
 * Guía interactiva del menú: una cuenta nueva la ve, «Saltar guía» no vuelve a salir, y se puede repetir desde el perfil.
 * Cada proyecto (escritorio y móvil) usa su propio alumno: la guía se marca como vista en el servidor compartido.
 */
const API = "http://localhost:8000/api/v1";
const HOOK = "http://localhost:8000/__e2e__";
const PASSWORD = "Password123";

async function login(page: Page, user: string) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder("Tu usuario").fill(user);
  await page.getByPlaceholder("••••••••").fill(PASSWORD);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("la guía sale a una cuenta nueva, se salta y no reaparece; se repite desde el perfil", async ({ page, request }, info) => {
  const username = `guia${info.project.name.replace(/\W/g, "")}${info.retry}`.toLowerCase();
  const res = await request.post(`${HOOK}/student/${username}?tour=1`);
  expect(res.ok()).toBeTruthy();

  await login(page, username);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("¡Te damos la bienvenida!")).toBeVisible();

  const saved = page.waitForResponse((r) => r.url().includes("/users/me") && r.request().method() === "PATCH");
  await dialog.getByRole("button", { name: "Saltar guía" }).click();
  await expect(dialog).toBeHidden();
  await saved;   // sin esto la recarga podría cortar el PATCH y la guía reaparecería

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("¡Te damos la bienvenida!")).toHaveCount(0);

  // Repetirla desde el perfil y recorrerla completa con «Siguiente» (en móvil abre el panel «Más»).
  await page.goto("/dashboard/profile");
  await page.getByRole("button", { name: "Ver guía de la plataforma" }).click();
  await expect(dialog.getByText("¡Te damos la bienvenida!")).toBeVisible();
  for (let i = 0; i < 20; i++) {
    const finish = dialog.getByRole("button", { name: "Terminar" });
    if (await finish.isVisible()) break;
    await dialog.getByRole("button", { name: "Siguiente" }).click();
  }
  await expect(dialog.getByText("Puedes repetir esta guía desde tu perfil")).toBeVisible();
  await dialog.getByRole("button", { name: "Terminar" }).click();
  await expect(dialog).toBeHidden();
});
