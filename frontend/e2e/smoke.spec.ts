import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const PASSWORD = "Password123";
const API = "http://localhost:8000/api/v1";

/** Inicia sesión por API (sin navegador) y devuelve las cabeceras para llamadas posteriores. */
async function apiAuth(request: APIRequestContext, user: string) {
  const res = await request.post(`${API}/auth/login`, { data: { login: user, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  const { access_token } = await res.json();
  return { Authorization: `Bearer ${access_token}` };
}

async function login(page: Page, user: string, password = PASSWORD) {
  await page.goto("/login");
  // WebKit (lento con `next dev`) rellena antes de hidratar y React borra lo escrito: se espera a que la red se calme.
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder("Tu usuario").fill(user);
  await page.getByPlaceholder("••••••••").fill(password);
  await page.locator("button[type=submit]").click();
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

  test("aviso de idiomas y guardado en el perfil (Fase 8)", async ({ page, request }) => {
    // los proyectos (escritorio, móvil, WebKit) comparten backend: se parte siempre sin idiomas
    const student = await apiAuth(request, "alumno");
    const reset = await request.patch(`${API}/users/me`, { headers: student, data: { spoken_languages: [] } });
    expect(reset.ok()).toBeTruthy();
    await login(page, "alumno");
    await expect(page).toHaveURL(/\/dashboard/);

    // ya terminó el onboarding y no tiene idiomas: aviso suave en el panel
    await expect(page.getByText("Agrega los idiomas que hablas")).toBeVisible();

    await page.goto("/dashboard/profile");
    await expect(page.getByRole("heading", { name: "Idiomas que hablo" })).toBeVisible();

    const save = page.getByRole("button", { name: "Guardar idiomas" });
    await expect(save).toBeDisabled(); // sin cambios no se puede guardar
    await page.getByRole("button", { name: "Español", exact: true }).click();
    await page.getByRole("button", { name: "Inglés", exact: true }).click();
    await expect(page.getByText("2 de 10 seleccionados")).toBeVisible();

    // Fase 10: cada idioma necesita su nivel; sin él no se puede guardar
    await expect(page.getByText(/elige el nivel de 2 idiomas/)).toBeVisible();
    await expect(save).toBeDisabled();
    await page.getByRole("radio", { name: "Español: Nativo" }).click();
    await expect(save).toBeDisabled(); // falta el de Inglés
    await page.getByRole("radio", { name: "Inglés: Intermedio" }).click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText("Idiomas guardados")).toBeVisible();

    // persiste tras recargar (idioma y nivel) y el aviso desaparece
    await page.reload();
    await expect(page.getByRole("button", { name: "Español", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Francés", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("radio", { name: "Español: Nativo" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("radio", { name: "Inglés: Intermedio" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("radio", { name: "Inglés: Nativo" })).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("Agrega los idiomas que hablas")).toHaveCount(0);
  });
});

test.describe("directorio de profesores (Fase 10)", () => {
  test("el alumno filtra por el idioma que habla el profesor", async ({ page, request }) => {
    // el profesor declara que habla francés (nativo), por API
    const teacher = await apiAuth(request, "profe");
    const saved = await request.patch(`${API}/users/me`, {
      headers: teacher, data: { spoken_languages: [{ language: "Francés", level: "native" }] },
    });
    expect(saved.ok()).toBeTruthy();

    await login(page, "alumno");
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/dashboard/teachers");
    await expect(page.getByText("Habla: francés (nativo)")).toBeVisible();

    const filter = page.getByLabel("Habla", { exact: true });
    await filter.selectOption("Francés");
    await expect(page.getByText("Habla: francés (nativo)")).toBeVisible();

    await filter.selectOption("Portugués");
    await expect(page.getByText(/Ningún profesor disponible habla Portugués/)).toBeVisible();

    await filter.selectOption("");
    await expect(page.getByText("Habla: francés (nativo)")).toBeVisible();
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
    // el estado inicial depende de qué proyecto corrió antes (backend compartido): se invierte lo que haya
    const welcome = page.getByRole("switch", { name: "Enviar: Bienvenida" });
    const before = (await welcome.getAttribute("aria-checked")) === "true";
    await welcome.click();
    await page.getByRole("button", { name: "Guardar correos" }).click();
    await expect(page.getByText("Configuración de correos guardada")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /Correos/ }).click();
    await expect(page.getByRole("switch", { name: "Enviar: Bienvenida" })).toHaveAttribute("aria-checked", String(!before));
  });
});
