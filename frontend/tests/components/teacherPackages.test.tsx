/**
 * Paquetes del profesor: crear / editar / desactivar, validaciones del formulario (precio, clases, grupales) y el
 * seguimiento de estudiantes con la petición de «paquete gratis».
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import PackagesPage from "@/app/(teacher)/teacher/packages/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo, FIXTURE } from "./fakeApi";

const PKG = (over: Record<string, unknown> = {}) => ({
  id: 5, name: "Pack 8", subject: "Matematica", description: "Ocho clases", description_type: "paragraph", description_items: null,
  icon: "🎯", color: "#ec4899", classes_count: 8, price: 80, price_per_class: 10, duration_minutes: 50, is_active: true,
  allow_installments: false, installment_count: null, is_group: false, min_students: null, max_students: null,
  group_schedule_mode: "manual", group_recurring_days_of_week: null, group_recurring_time_local: null, ...over,
});
const ENR = (over: Record<string, unknown> = {}) => ({
  id: 21, student_id: 7, student_username: "ana", student_name: "Ana Pérez", package_id: 5, package_name: "Pack 8",
  classes_used: 2, classes_total: 8, available_credits: 6, status: "active", completed_count: 2, no_show_count: 0,
  cancelled_late_count: 0, renewal_requested_package_name: null, change_requested_package_name: null, created_at: "2026-01-01T00:00:00Z", ...over,
});

function setup(packages: unknown[] = [PKG()], enrollments: unknown[] = [], role: "teacher" | "teacher_admin" = "teacher", extra?: () => void) {
  mockApi("get", "/packages/my-packages", packages);
  mockApi("get", /^\/packages\/teacher\/enrollments/, enrollments);
  mockApi("get", "/teachers/me/profile", { ...FIXTURE.teacher, subjects: [], languages: [] });
  extra?.();
  const view = renderScreen(<PackagesPage />, { role });
  return { ...view, user: userEvent.setup() };
}

afterEach(() => { vi.restoreAllMocks(); });

async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Pack 8");
  await user.click(screen.getByRole("button", { name: /Nuevo paquete/ }));
  return screen.findByPlaceholderText("Ej: Paquete Intensivo B1");
}
const field = (ph: string) => screen.getByPlaceholderText(ph) as HTMLInputElement;
async function fillBasic(user: ReturnType<typeof userEvent.setup>, o: { classes?: string; price?: string; per?: string } = {}) {
  await user.type(await screen.findByPlaceholderText("Ej: Paquete Intensivo B1"), "Intensivo");
  await user.selectOptions(screen.getAllByRole("combobox")[0], "Matematica");
  await user.clear(field("Ej: 8")); // el formulario trae valores por defecto
  await user.type(field("Ej: 8"), o.classes ?? "4");
  await user.clear(field("Ej: 50.00"));
  await user.type(field("Ej: 50.00"), o.price ?? "40");
  const per = field("Ej: 6.25");
  await user.clear(per); // se autocompleta con precio ÷ clases
  await user.type(per, o.per ?? "10");
}

describe("Paquetes del profesor · lista", () => {
  it("muestra sus paquetes", async () => {
    setup();
    expect(await screen.findByText("Pack 8")).toBeInTheDocument();
    expect(screen.getByText(/Paquetes \(1\)/)).toBeInTheDocument();
  });

  it("sin paquetes lo dice", async () => {
    setup([]);
    expect(await screen.findByText("Aún no has creado ningún paquete")).toBeInTheDocument();
  });

  it("si fallan no muestra «aún no has creado» sino el error", async () => {
    setup([], [], "teacher", () => mockApiError("get", "/packages/my-packages", 500, "x"));
    await waitFor(() => expect(screen.queryByText("Aún no has creado ningún paquete")).not.toBeInTheDocument());
  });

  it("desactivar pide confirmación y llama a DELETE", async () => {
    mockApi("delete", "/packages/5", {});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = setup();
    await screen.findByText("Pack 8");
    const card = screen.getByText("Pack 8").closest("[class*='rounded']")!.parentElement as HTMLElement;
    const buttons = within(card).getAllByRole("button");
    await user.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(callsTo("delete", "/packages/5")).toHaveLength(1));
    expect(await screen.findByText("Paquete desactivado correctamente")).toBeInTheDocument();
  });

  it("si se rechaza la confirmación no desactiva", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user } = setup();
    await screen.findByText("Pack 8");
    const card = screen.getByText("Pack 8").closest("[class*='rounded']")!.parentElement as HTMLElement;
    const buttons = within(card).getAllByRole("button");
    await user.click(buttons[buttons.length - 1]);
    expect(callsTo("delete", "/packages/5")).toHaveLength(0);
  });

  it("un error al desactivar se avisa", async () => {
    mockApiError("delete", "/packages/5", 500, "No se pudo desactivar");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = setup();
    await screen.findByText("Pack 8");
    const card = screen.getByText("Pack 8").closest("[class*='rounded']")!.parentElement as HTMLElement;
    const buttons = within(card).getAllByRole("button");
    await user.click(buttons[buttons.length - 1]);
    expect(await screen.findByText("No se pudo desactivar")).toBeInTheDocument();
  });
});

describe("Paquetes del profesor · crear", () => {
  it("sin nombre ni materia el botón está desactivado", async () => {
    const { user } = setup();
    await openCreate(user);
    expect(screen.getByRole("button", { name: "Crear paquete" })).toBeDisabled();
  });

  it("crea un paquete individual con precio por clase coherente", async () => {
    mockApi("post", "/packages/", { id: 9 });
    const { user } = setup();
    await openCreate(user);
    await fillBasic(user);
    await user.click(screen.getByRole("button", { name: "Crear paquete" }));
    await waitFor(() => expect(callsTo("post", "/packages/")).toHaveLength(1));
    expect(callsTo("post", "/packages/")[0].body).toMatchObject({
      name: "Intensivo", subject: "Matematica", classes_count: 4, price: 40, price_per_class: 10, is_group: false, allow_installments: false,
    });
    expect(await screen.findByText("Paquete creado correctamente")).toBeInTheDocument();
  });

  it("el precio por clase debe cuadrar con el total", async () => {
    const { user } = setup();
    await openCreate(user);
    await fillBasic(user, { classes: "4", price: "40", per: "9" });
    await user.click(screen.getByRole("button", { name: "Crear paquete" }));
    expect(await screen.findByText(/no coincide con el precio total/)).toBeInTheDocument();
    expect(callsTo("post", "/packages/")).toHaveLength(0);
  });

  it.each([
    ["clases 0", { classes: "0", price: "40", per: "10" }, /número de clases válido/],
    ["precio 0", { classes: "4", price: "0", per: "10" }, /precio válido/],
  ] as const)("validación: %s", async (_n, vals, msg) => {
    const { user } = setup();
    await openCreate(user);
    await fillBasic(user, vals);
    await user.click(screen.getByRole("button", { name: "Crear paquete" }));
    expect(await screen.findByText(msg)).toBeInTheDocument();
    expect(callsTo("post", "/packages/")).toHaveLength(0);
  });

  it("sin precio de clase suelta lo pide", async () => {
    const { user } = setup();
    await openCreate(user);
    await user.type(field("Ej: Paquete Intensivo B1"), "Intensivo");
    await user.selectOptions(screen.getAllByRole("combobox")[0], "Matematica");
    await user.clear(field("Ej: 8"));
    await user.type(field("Ej: 8"), "4");
    await user.clear(field("Ej: 50.00"));
    await user.type(field("Ej: 50.00"), "40");
    await user.clear(field("Ej: 6.25"));
    await user.click(screen.getByRole("button", { name: "Crear paquete" }));
    expect(await screen.findByText(/precio de una clase suelta/)).toBeInTheDocument();
  });

  it("«Ilimitadas» no pide número de clases ni precio por clase y envía null", async () => {
    mockApi("post", "/packages/", { id: 9 });
    const { user } = setup();
    await openCreate(user);
    await user.type(field("Ej: Paquete Intensivo B1"), "Ilimitado");
    await user.selectOptions(screen.getAllByRole("combobox")[0], "Matematica");
    await user.click(screen.getByRole("button", { name: /Marcar ilimitadas/ }));
    await user.clear(field("Ej: 50.00"));
    await user.type(field("Ej: 50.00"), "99");
    await user.click(screen.getByRole("button", { name: "Crear paquete" }));
    await waitFor(() => expect(callsTo("post", "/packages/")).toHaveLength(1));
    expect(callsTo("post", "/packages/")[0].body).toMatchObject({ classes_count: null, price_per_class: null, installment_count: null });
  });

  it("cambiar a «Idiomas» vacía la materia y ofrece los idiomas", async () => {
    const { user } = setup();
    await openCreate(user);
    await user.selectOptions(screen.getAllByRole("combobox")[0], "Matematica");
    await user.click(screen.getByRole("button", { name: "Un idioma" }));
    expect(screen.getAllByRole("combobox")[0]).toHaveValue("");
    expect(within(screen.getAllByRole("combobox")[0]).getByRole("option", { name: "Español" })).toBeInTheDocument();
  });

  it("descripción en lista: añade con Enter y quita elementos", async () => {
    mockApi("post", "/packages/", { id: 9 });
    const { user } = setup();
    await openCreate(user);
    await fillBasic(user);
    await user.click(screen.getByRole("button", { name: "Lista de puntos" }));
    const item = screen.getByPlaceholderText("Ej: Material incluido — presiona Enter");
    await user.type(item, "Material incluido{enter}");
    await user.type(item, "Soporte{enter}");
    expect(screen.getByText("Soporte")).toBeInTheDocument();
    await user.click(screen.getByText("Soporte").parentElement!.querySelector("button") as HTMLElement);
    expect(screen.queryByText("Soporte")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Crear paquete" }));
    await waitFor(() => expect(callsTo("post", "/packages/")).toHaveLength(1));
    expect(callsTo("post", "/packages/")[0].body).toMatchObject({ description_type: "list", description_items: ["Material incluido"], description: null });
  });

  it("un error del servidor se muestra y mantiene el formulario abierto", async () => {
    mockApiError("post", "/packages/", 400, "Ya existe un paquete con ese nombre");
    const { user } = setup();
    await openCreate(user);
    await fillBasic(user);
    await user.click(screen.getByRole("button", { name: "Crear paquete" }));
    expect(await screen.findByText("Ya existe un paquete con ese nombre")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ej: Paquete Intensivo B1")).toBeInTheDocument();
  });
});

describe("Paquetes del profesor · grupales", () => {
  async function toGroup(user: ReturnType<typeof userEvent.setup>) {
    await openCreate(user);
    await fillBasic(user);
    const label = screen.getByText(/Paquete grupal \(clases compartidas/);
    const toggle = label.closest("div")!.parentElement!.querySelector("button") as HTMLElement;
    await user.click(toggle);
  }

  it("activar «grupal» muestra mínimo/máximo de alumnos y manda is_group con sus límites", async () => {
    mockApi("post", "/packages/", { id: 9 });
    const { user } = setup();
    await toGroup(user);
    await user.click(screen.getByRole("button", { name: "Crear paquete" }));
    await waitFor(() => expect(callsTo("post", "/packages/")).toHaveLength(1));
    expect(callsTo("post", "/packages/")[0].body).toMatchObject({ is_group: true, min_students: 3, max_students: 6, allow_installments: false, group_schedule_mode: "manual" });
  });

  it("el máximo no puede ser menor que el mínimo", async () => {
    const { user } = setup();
    await toGroup(user);
    const max = screen.getByDisplayValue("6"); // máximo por defecto
    await user.clear(max);
    await user.type(max, "1");
    await user.click(screen.getByRole("button", { name: "Crear paquete" }));
    expect(await screen.findByText(/máximo de alumnos no puede ser menor/)).toBeInTheDocument();
  });

  it("horario fijo exige al menos un día de la semana", async () => {
    const { user } = setup();
    await toGroup(user);
    await user.click(screen.getByRole("button", { name: /Fijo y recurrente/ }));
    await user.click(screen.getByRole("button", { name: "Crear paquete" }));
    expect(await screen.findByText(/al menos un día de la semana/)).toBeInTheDocument();
  });
});

describe("Paquetes del profesor · editar", () => {
  it("editar precarga el paquete y guarda con PATCH", async () => {
    mockApi("patch", "/packages/5", {});
    const { user } = setup();
    await screen.findByText("Pack 8");
    const card = screen.getByText("Pack 8").closest("[class*='rounded']")!.parentElement as HTMLElement;
    await user.click(within(card).getAllByRole("button")[0]);
    expect(await screen.findByDisplayValue("Pack 8")).toBeInTheDocument();
    const name = screen.getByDisplayValue("Pack 8");
    await user.clear(name);
    await user.type(name, "Pack 8 plus");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(callsTo("patch", "/packages/5")).toHaveLength(1));
    expect(callsTo("patch", "/packages/5")[0].body).toMatchObject({ name: "Pack 8 plus", classes_count: 8, price: 80 });
    expect(await screen.findByText("Paquete actualizado correctamente")).toBeInTheDocument();
  });

  it("un paquete ilimitado se edita en modo «Ilimitadas»", async () => {
    const { user } = setup([PKG({ classes_count: null, price_per_class: null })]);
    await screen.findByText("Pack 8");
    const card = screen.getByText("Pack 8").closest("[class*='rounded']")!.parentElement as HTMLElement;
    await user.click(within(card).getAllByRole("button")[0]);
    expect(await screen.findByPlaceholderText("Ilimitadas")).toBeDisabled();
  });
});

describe("Paquetes del profesor · seguimiento de estudiantes", () => {
  it("lista los estudiantes con su estado y progreso", async () => {
    setup([PKG()], [ENR(), ENR({ id: 22, student_name: "Luis G", status: "completed" })]);
    expect(await screen.findByText(/Seguimiento de estudiantes \(2\)/)).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
    expect(screen.getByText("Agotado")).toBeInTheDocument();
    expect(screen.getAllByText(/2\/8 usadas/).length).toBeGreaterThan(0);
  });

  it("sin estudiantes con paquete lo dice", async () => {
    setup([PKG()], []);
    expect(await screen.findByText("Aún no tienes estudiantes con paquetes asignados")).toBeInTheDocument();
  });

  it.each([
    ["package_pending_payment", /Esperando pago inicial/],
    ["pending_renewal", /Pidió: Pack 12/],
    ["pending_package_change", /Quiere cambiar a: Pack 12/],
  ] as const)("estado %s ofrece pedir paquete gratis", async (status, text) => {
    setup([PKG()], [ENR({ status, renewal_requested_package_name: "Pack 12", change_requested_package_name: "Pack 12" })]);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pedir paquete gratis/ })).toBeInTheDocument();
  });

  it("pedir paquete gratis: pide el motivo y lo envía al staff", async () => {
    mockApi("post", "/payments/manual-grant-requests", {});
    const { user } = setup([PKG()], [ENR({ status: "package_pending_payment" })]);
    await user.click(await screen.findByRole("button", { name: /Pedir paquete gratis/ }));
    await user.type(await screen.findByPlaceholderText(/beca acordada/), "Beca acordada");
    await user.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    await waitFor(() => expect(callsTo("post", "/payments/manual-grant-requests")).toHaveLength(1));
    expect(callsTo("post", "/payments/manual-grant-requests")[0].body).toEqual({ enrollment_id: 21, reason: "Beca acordada" });
    expect(await screen.findByText(/Solicitud enviada/)).toBeInTheDocument();
  });

  it("un error al enviar la solicitud se avisa", async () => {
    mockApiError("post", "/payments/manual-grant-requests", 400, "Ya hay una solicitud");
    const { user } = setup([PKG()], [ENR({ status: "package_pending_payment" })]);
    await user.click(await screen.findByRole("button", { name: /Pedir paquete gratis/ }));
    await user.type(await screen.findByPlaceholderText(/beca acordada/), "Beca");
    await user.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    expect(await screen.findByText("Ya hay una solicitud")).toBeInTheDocument();
  });

  it("si falla el seguimiento ofrece reintentar", async () => {
    setup([PKG()], [], "teacher", () => mockApiError("get", /^\/packages\/teacher\/enrollments/, 500, "x"));
    expect(await screen.findByText(/No se pudo cargar/)).toBeInTheDocument();
  });
});

describe("Paquetes del profesor · casos secundarios", () => {
  it("con materias en el perfil solo ofrece esas materias", async () => {
    const { user } = setup([PKG()], [], "teacher", () => mockApi("get", "/teachers/me/profile", { ...FIXTURE.teacher, subjects: ["Matematica"], languages: [] }));
    await openCreate(user);
    const options = Array.from((screen.getAllByRole("combobox")[0] as HTMLSelectElement).options).map((o) => o.value).filter(Boolean);
    expect(options).toEqual(["Matematica"]);
  });

  it("el teacher_admin ve el enlace a pagos pendientes", async () => {
    setup([PKG()], [], "teacher_admin");
    expect(await screen.findByRole("link", { name: /Ver pagos pendientes/ })).toHaveAttribute("href", "/teacher/payments");
  });

  it("al editar un paquete sin precio por clase lo calcula del total", async () => {
    const { user } = setup([PKG({ price_per_class: null })]);
    await screen.findByText("Pack 8");
    const card = screen.getByText("Pack 8").closest("[class*='rounded']")!.parentElement as HTMLElement;
    await user.click(within(card).getAllByRole("button")[0]);
    expect(await screen.findByDisplayValue("10.00")).toBeInTheDocument();
  });

  it("la lista muestra beneficios, cuotas e insignia de grupal", async () => {
    setup([PKG({ description_type: "list", description_items: ["Material incluido"], allow_installments: true, installment_count: 4, is_group: true, min_students: 2, max_students: 5 })]);
    expect(await screen.findByText("Material incluido")).toBeInTheDocument();
    expect(screen.getByText(/en 4 cuotas de \$ 20\.00/i)).toBeInTheDocument();
    expect(screen.getByText("Grupal")).toBeInTheDocument();
  });

  it("un mínimo de alumnos inválido en un grupal se avisa", async () => {
    const { user } = setup();
    await openCreate(user);
    await fillBasic(user);
    const toggle = screen.getByText(/Paquete grupal \(clases compartidas/).closest("div")!.parentElement!.querySelector("button") as HTMLElement;
    await user.click(toggle);
    const min = screen.getByDisplayValue("3");
    await user.clear(min);
    await user.click(screen.getByRole("button", { name: "Crear paquete" }));
    expect(await screen.findByText(/mínimo de alumnos válido/)).toBeInTheDocument();
  });

  it("horario fijo: se eligen y quitan días de la semana", async () => {
    const { user } = setup();
    await openCreate(user);
    await fillBasic(user);
    const toggle = screen.getByText(/Paquete grupal \(clases compartidas/).closest("div")!.parentElement!.querySelector("button") as HTMLElement;
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: /Fijo y recurrente/ }));
    const lun = screen.getByRole("button", { name: "Lun" });
    const before = lun.className;
    await user.click(lun);
    expect(lun.className).not.toBe(before);
    await user.click(lun);
    expect(lun.className).toBe(before);
  });

  it("añadir un elemento de la descripción con el botón «+»", async () => {
    const { user } = setup();
    await openCreate(user);
    await user.click(screen.getByRole("button", { name: /Lista|Viñetas/ }));
    const input = await screen.findByPlaceholderText(/Material incluido/);
    await user.type(input, "Soporte");
    await user.click(input.nextElementSibling as HTMLElement);
    expect(await screen.findByText("Soporte")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("«Sugerir según materia» aplica el icono y color sugeridos", async () => {
    const { user } = setup();
    await openCreate(user);
    await user.click(screen.getByRole("button", { name: "Sugerir según materia" }));
    expect(screen.getByRole("button", { name: "Sugerir según materia" })).toBeInTheDocument();
  });

  it("pago en cuotas: pide el número y muestra el valor de cada cuota", async () => {
    const { user } = setup();
    await openCreate(user);
    await fillBasic(user, { classes: "4", price: "40", per: "10" });
    const toggle = screen.getByText("Permitir pago en cuotas").closest("div")!.parentElement!.querySelector("button") as HTMLElement;
    await user.click(toggle);
    const cuotas = screen.getByText(/Número de cuotas/).parentElement!.querySelector("input") as HTMLInputElement;
    await user.clear(cuotas);
    await user.type(cuotas, "4");
    expect(await screen.findByText("$10.00 por cuota")).toBeInTheDocument();
    await user.type(cuotas, "x"); // solo dígitos
    expect(cuotas).toHaveValue("4");
  });

  it("un estudiante con paquete ilimitado no muestra progreso", async () => {
    setup([PKG()], [ENR({ classes_total: null, available_credits: 3 })]);
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
  });
});
