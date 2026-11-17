import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Password123";

async function login(page: Page, user: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByPlaceholder("Tu usuario").fill(user);
  await page.getByPlaceholder("••••••••").fill(password);
  await page.getByRole("button", { name: /Iniciar sesión/ }).click();
}

test.describe("público", () => {
  test("la portada carga", async ({ page }) => {
    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("el login muestra el formulario y rechaza una contraseña mala", async ({ page }) => {
    await login(page, "alumno", "mala-contraseña");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/incorrect|inválid|credenciales|contraseña/i).first()).toBeVisible();
  });

  test("una ruta privada sin sesión redirige al login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("alumno", () => {
  test("inicia sesión y llega a su dashboard", async ({ page }) => {
    await login(page, "alumno");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("aviso de idiomas y guardado en el perfil (Fase 8)", async ({ page }) => {
    await login(page, "alumno");
    await expect(page).toHaveURL(/\/dashboard/);

    // ya terminó el onboarding y no tiene idiomas: aviso suave en el panel
    await expect(page.getByText("Agrega los idiomas que hablas")).toBeVisible();

    await page.goto("/dashboard/profile");
    await expect(page.getByRole("heading", { name: "Idiomas que hablo" })).toBeVisible();

    const save = page.getByRole("button", { name: "Guardar idiomas" });
    await expect(save).toBeDisabled(); // sin cambios no se puede guardar
    await page.getByRole("button", { name: "Español" }).click();
    await page.getByRole("button", { name: "Inglés" }).click();
    await expect(page.getByText("2 de 10 seleccionados")).toBeVisible();
    await save.click();
    await expect(page.getByText("Idiomas guardados")).toBeVisible();

    // persiste tras recargar y el aviso desaparece
    await page.reload();
    await expect(page.getByRole("button", { name: "Español" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Francés" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("Agrega los idiomas que hablas")).toHaveCount(0);
  });
});

test.describe("alumno nuevo", () => {
  test("sin onboarding terminado lo envía al onboarding", async ({ page }) => {
    await login(page, "nuevo");
    await expect(page).toHaveURL(/\/dashboard\/onboarding/);
    await expect(page.getByRole("heading", { name: /Hola, Nuevo/ })).toBeVisible();
  });
});

test.describe("superadmin", () => {
  test("la pestaña Correos muestra el uso diario y los interruptores (Fase 7)", async ({ page }) => {
    await login(page, "admin");
    await expect(page).toHaveURL(/\/admin/);
    await page.goto("/admin/settings");
    await page.getByRole("button", { name: /Correos/ }).click();
    await expect(page.getByText("Notificaciones por email")).toBeVisible();
    await expect(page.getByTestId("email-usage")).toHaveText("0 / 100");
    // los esenciales no se pueden apagar
    await expect(page.getByRole("switch", { name: /Esenciales .*siempre activo/ })).toBeDisabled();
    // apagar una categoría y guardar
    const welcome = page.getByRole("switch", { name: "Enviar: Bienvenida" });
    await expect(welcome).toHaveAttribute("aria-checked", "true");
    await welcome.click();
    await page.getByRole("button", { name: "Guardar correos" }).click();
    await expect(page.getByText("Configuración de correos guardada")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /Correos/ }).click();
    await expect(page.getByRole("switch", { name: "Enviar: Bienvenida" })).toHaveAttribute("aria-checked", "false");
  });
});
