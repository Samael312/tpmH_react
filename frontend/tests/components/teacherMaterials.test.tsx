/**
 * Materiales del profesor: subir documentos y sets de vocabulario, buscar, y asignar / editar / borrar cada material.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import MaterialsPage from "@/app/(teacher)/teacher/materials/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const DOC = {
  id: 1, title: "Guía de gramática", description: "Verbos irregulares", category: "Guides", level: "B1",
  file_url: "https://cdn.example.com/guia.pdf", file_type: "application/pdf", created_at: "2026-01-01T00:00:00Z", vocabulary_words: null,
};
const VOCAB = {
  id: 2, title: "Viajes", description: null, category: "Vocabulary", level: "A2",
  file_url: null, file_type: null, created_at: "2026-01-02T00:00:00Z", vocabulary_words: ["Avión", "Hotel"],
};
const STUDENTS = [
  { id: 7, name: "Ana", surname: "Pérez", username: "ana", avatar_url: null },
  { id: 8, name: "Luis", surname: "Gómez", username: "luis", avatar_url: null },
];

function setup(materials: unknown[] = [DOC, VOCAB], extra?: () => void) {
  mockApi("get", "/materials/my-materials", materials);
  mockApi("get", /^\/teachers\/me\/students/, STUDENTS);
  mockApi("get", /^\/cohorts\/teacher/, []);
  extra?.();
  const view = renderScreen(<MaterialsPage />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}

const inCard = (title: string, name: string) => within(screen.getByText(title).closest("[class*='p-5']") as HTMLElement).getByRole("button", { name });

afterEach(() => { vi.restoreAllMocks(); });

describe("Materiales · lista", () => {
  it("muestra los contadores y, por defecto, los documentos", async () => {
    setup();
    expect(await screen.findByText("Guía de gramática")).toBeInTheDocument();
    expect(screen.queryByText("Viajes")).not.toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("la pestaña Vocabulario muestra los sets con su número de palabras", async () => {
    const { user } = setup();
    await screen.findByText("Guía de gramática");
    await user.click(screen.getByRole("button", { name: "Vocabulario" }));
    expect(await screen.findByText("Viajes")).toBeInTheDocument();
    expect(screen.getByText("2 palabras")).toBeInTheDocument();
  });

  it("buscar filtra por título", async () => {
    const { user } = setup([DOC, { ...DOC, id: 3, title: "Examen final" }]);
    await screen.findByText("Guía de gramática");
    await user.type(screen.getByPlaceholderText("Buscar material..."), "examen");
    expect(screen.queryByText("Guía de gramática")).not.toBeInTheDocument();
    expect(screen.getByText("Examen final")).toBeInTheDocument();
  });

  it("sin materiales invita a crear el primero", async () => {
    const { user } = setup([]);
    expect(await screen.findByText("No hay materiales todavía")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Crear el primero/ }));
    expect(await screen.findByPlaceholderText("Ej: Guía de gramática B1")).toBeInTheDocument();
  });

  it("si falla la carga muestra el error con Reintentar en vez de «no hay materiales»", async () => {
    setup([], () => mockApiError("get", "/materials/my-materials", 500, "x"));
    expect(await screen.findByText("No se pudieron cargar tus materiales")).toBeInTheDocument();
    expect(screen.queryByText("No hay materiales todavía")).not.toBeInTheDocument();
  });
});

describe("Materiales · subir documento", () => {
  async function openForm(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText("Guía de gramática");
    await user.click(screen.getByRole("button", { name: /Nuevo material/ }));
    return screen.findByPlaceholderText("Ej: Guía de gramática B1");
  }
  const pdf = () => new File(["pdf"], "guia.pdf", { type: "application/pdf" });

  it("el botón de subir está desactivado sin título y archivo", async () => {
    const { user } = setup();
    await openForm(user);
    expect(screen.getByRole("button", { name: "Subir material" })).toBeDisabled();
  });

  it("título + archivo: sube con FormData (título, categoría, nivel, archivo) y avisa", async () => {
    mockApi("post", "/materials/", { id: 9 });
    const { user, container } = setup();
    const title = await openForm(user);
    await user.type(title, "Nuevo PDF");
    await user.type(screen.getByPlaceholderText(/Breve descripción de qué trata/), "Algo");
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [pdf()] } });
    await user.click(await screen.findByRole("button", { name: "Subir material" }));
    await waitFor(() => expect(callsTo("post", "/materials/")).toHaveLength(1));
    const form = callsTo("post", "/materials/")[0].body as FormData;
    expect(form.get("title")).toBe("Nuevo PDF");
    expect(form.get("description")).toBe("Algo");
    expect((form.get("file") as File).name).toBe("guia.pdf");
    expect(await screen.findByText("Material subido correctamente")).toBeInTheDocument();
  });

  it("un error de subida se muestra dentro del formulario y se puede cerrar", async () => {
    mockApiError("post", "/materials/", 413, "Archivo demasiado grande");
    const { user, container } = setup();
    const title = await openForm(user);
    await user.type(title, "Grande");
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [pdf()] } });
    await user.click(await screen.findByRole("button", { name: "Subir material" }));
    expect(await screen.findByText("Archivo demasiado grande")).toBeInTheDocument();
  });

  it("quitar el archivo elegido vuelve a desactivar el botón", async () => {
    const { user, container } = setup();
    const title = await openForm(user);
    await user.type(title, "X");
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [pdf()] } });
    expect(await screen.findByText("guia.pdf")).toBeInTheDocument();
    await user.click(screen.getByText("guia.pdf").closest("div")!.parentElement!.querySelector("button") as HTMLElement);
    expect(screen.getByRole("button", { name: "Subir material" })).toBeDisabled();
  });

  it("«Cerrar» oculta el formulario", async () => {
    const { user } = setup();
    await openForm(user);
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByPlaceholderText("Ej: Guía de gramática B1")).not.toBeInTheDocument();
  });
});

describe("Materiales · crear vocabulario", () => {
  async function openVocab(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText("Guía de gramática");
    await user.click(screen.getByRole("button", { name: /Nuevo material/ }));
    const tabs = screen.getAllByRole("button", { name: "Vocabulario" });
    await user.click(tabs[0]);
    return screen.findByPlaceholderText("Ej: Vocabulario de viajes");
  }

  it("las palabras se capitalizan, aceptan varias separadas por coma y no se repiten", async () => {
    const { user } = setup();
    await openVocab(user);
    const word = screen.getByPlaceholderText("Escribe una palabra y presiona Enter...");
    await user.type(word, "casa, perro{enter}");
    await user.type(word, "casa{enter}");
    expect(screen.getByText("Casa")).toBeInTheDocument();
    expect(screen.getByText("Perro")).toBeInTheDocument();
    expect(screen.getAllByText("Casa")).toHaveLength(1);
  });

  it("envía el idioma elegido del catálogo al guardar las palabras", async () => {
    mockApi("get", "/system-catalogs/", { spoken_languages: ["Español", "Inglés"] });
    mockApi("post", "/materials/", { id: 45 });
    mockApi("post", "/materials/45/vocabulary", {});
    const { user } = setup();
    const title = await openVocab(user);
    await user.type(title, "Frutas");
    await user.type(screen.getByPlaceholderText("Escribe una palabra y presiona Enter..."), "pera{enter}");
    await user.selectOptions(await screen.findByRole("option", { name: "Español" }).then(o => o.closest("select")!), "Español");
    await user.click(screen.getByRole("button", { name: "Crear set de vocabulario" }));
    await waitFor(() => expect(callsTo("post", "/materials/45/vocabulary")).toHaveLength(1));
    expect(callsTo("post", "/materials/45/vocabulary")[0].body).toEqual({ words: ["Pera"], language: "Español" });
  });

  it("crea el set: primero el material y luego sus palabras", async () => {
    mockApi("post", "/materials/", { id: 44 });
    mockApi("post", "/materials/44/vocabulary", {});
    const { user } = setup();
    const title = await openVocab(user);
    await user.type(title, "Animales");
    await user.type(screen.getByPlaceholderText("Escribe una palabra y presiona Enter..."), "gato{enter}");
    await user.click(screen.getByRole("button", { name: "Crear set de vocabulario" }));
    await waitFor(() => expect(callsTo("post", "/materials/44/vocabulary")).toHaveLength(1));
    expect(callsTo("post", "/materials/44/vocabulary")[0].body).toEqual({ words: ["Gato"], language: "" });
    expect((callsTo("post", "/materials/")[0].body as FormData).get("category")).toBe("Vocabulary");
    expect(await screen.findByText("Vocabulario creado correctamente")).toBeInTheDocument();
  });

  it("quitar una palabra la saca de la lista", async () => {
    const { user } = setup();
    await openVocab(user);
    await user.type(screen.getByPlaceholderText("Escribe una palabra y presiona Enter..."), "gato{enter}");
    await user.click(screen.getByText("Gato").parentElement!.querySelector("button") as HTMLElement);
    expect(screen.queryByText("Gato")).not.toBeInTheDocument();
  });

  it("un error al crear el set se avisa", async () => {
    mockApiError("post", "/materials/", 500, "Falló la creación");
    const { user } = setup();
    const title = await openVocab(user);
    await user.type(title, "Animales");
    await user.type(screen.getByPlaceholderText("Escribe una palabra y presiona Enter..."), "gato{enter}");
    await user.click(screen.getByRole("button", { name: "Crear set de vocabulario" }));
    expect(await screen.findByText("Falló la creación")).toBeInTheDocument();
  });
});

describe("Materiales · asignar", () => {
  it("elegir estudiantes y asignar manda sus ids", async () => {
    mockApi("post", "/materials/1/assign", {});
    const { user } = setup();
    await screen.findByText("Guía de gramática");
    await user.click(inCard("Guía de gramática", "Asignar"));
    expect(await screen.findByText("Asignar material")).toBeInTheDocument();
    await user.click(await screen.findByText(/Ana/));
    await user.click(screen.getAllByRole("button", { name: /Asignar/ }).at(-1) as HTMLElement);
    await waitFor(() => expect(callsTo("post", "/materials/1/assign")).toHaveLength(1));
    expect((callsTo("post", "/materials/1/assign")[0].body as { student_ids: number[] }).student_ids).toEqual([7]);
    expect(await screen.findByText("¡Asignado correctamente!")).toBeInTheDocument();
  });

  it("buscar filtra la lista de estudiantes", async () => {
    const { user } = setup();
    await screen.findByText("Guía de gramática");
    await user.click(inCard("Guía de gramática", "Asignar"));
    await user.type(await screen.findByPlaceholderText("Buscar por nombre o usuario..."), "luis");
    expect(screen.queryByText(/Ana/)).not.toBeInTheDocument();
    expect(screen.getByText(/Luis/)).toBeInTheDocument();
  });

  it("sin estudiantes lo dice", async () => {
    const { user } = setup([DOC, VOCAB], () => mockApi("get", /^\/teachers\/me\/students/, []));
    await screen.findByText("Guía de gramática");
    await user.click(inCard("Guía de gramática", "Asignar"));
    expect(await screen.findByText("Aún no tienes estudiantes asignados")).toBeInTheDocument();
  });

  it("también se puede asignar a un grupo completo", async () => {
    mockApi("post", "/materials/1/assign", {});
    const { user } = setup([DOC, VOCAB], () => {
      mockApi("get", /^\/cohorts\/teacher/, [{ id: 5, package_name: "Grupal", current_students: 3 }]);
      mockApi("get", "/cohorts/5/members", []);
    });
    await screen.findByText("Guía de gramática");
    await user.click(inCard("Guía de gramática", "Asignar"));
    await user.selectOptions(await screen.findByRole("combobox"), "5");
    expect(await screen.findByText(/Se asignará a todos los integrantes activos de este grupo/)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /Asignar/ }).at(-1) as HTMLElement);
    await waitFor(() => expect(callsTo("post", "/materials/1/assign")).toHaveLength(1));
    expect(callsTo("post", "/materials/1/assign")[0].body).toMatchObject({ cohort_id: 5 });
  });

  it("un error al asignar se avisa", async () => {
    mockApiError("post", "/materials/1/assign", 400, "No se pudo");
    const { user } = setup();
    await screen.findByText("Guía de gramática");
    await user.click(inCard("Guía de gramática", "Asignar"));
    await user.click(await screen.findByText(/Ana/));
    await user.click(screen.getAllByRole("button", { name: /Asignar/ }).at(-1) as HTMLElement);
    expect(await screen.findByText("No se pudo")).toBeInTheDocument();
  });

  it("si fallan los estudiantes ofrece reintentar", async () => {
    const { user } = setup([DOC, VOCAB], () => mockApiError("get", /^\/teachers\/me\/students/, 500, "x"));
    await screen.findByText("Guía de gramática");
    await user.click(inCard("Guía de gramática", "Asignar"));
    expect(await screen.findByRole("button", { name: /Reintentar/ })).toBeInTheDocument();
  });
});

describe("Materiales · editar, palabras y borrar", () => {
  it("editar detalles: cambia título y nivel y guarda con PATCH", async () => {
    mockApi("patch", "/materials/1", { ...DOC, title: "Guía v2" });
    const { user } = setup();
    await screen.findByText("Guía de gramática");
    await user.click(inCard("Guía de gramática", "Detalles"));
    const title = await screen.findByPlaceholderText("Título del material");
    await user.clear(title);
    await user.type(title, "Guía v2");
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(callsTo("patch", "/materials/1")).toHaveLength(1));
    expect(callsTo("patch", "/materials/1")[0].body).toMatchObject({ title: "Guía v2" });
    expect(await screen.findByText("Material actualizado correctamente")).toBeInTheDocument();
    expect(await screen.findByText("Guía v2")).toBeInTheDocument();
  });

  it("un error al editar se muestra en el modal", async () => {
    mockApiError("patch", "/materials/1", 400, "Título repetido");
    const { user } = setup();
    await screen.findByText("Guía de gramática");
    await user.click(inCard("Guía de gramática", "Detalles"));
    await screen.findByPlaceholderText("Título del material");
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    expect(await screen.findByText("Título repetido")).toBeInTheDocument();
  });

  it("un set de vocabulario no deja cambiar su categoría", async () => {
    const { user } = setup();
    await screen.findByText("Guía de gramática");
    await user.click(screen.getByRole("button", { name: "Vocabulario" }));
    await user.click(inCard("Viajes", "Detalles"));
    expect((await screen.findAllByText("Vocabulary")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("combobox", { name: /Categoría/ })).not.toBeInTheDocument();
  });

  it("editar palabras: añadir, quitar y guardar", async () => {
    mockApi("post", "/materials/2/vocabulary", {});
    const { user } = setup();
    await screen.findByText("Guía de gramática");
    await user.click(screen.getByRole("button", { name: "Vocabulario" }));
    await user.click(inCard("Viajes", "Palabras"));
    expect(await screen.findByText("Editar palabras")).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/palabra/i);
    await user.type(input, "tren{enter}");
    expect(screen.getByText("Tren")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(callsTo("post", "/materials/2/vocabulary")).toHaveLength(1));
    expect(callsTo("post", "/materials/2/vocabulary")[0].body).toEqual({ words: ["Avión", "Hotel", "Tren"], language: "" });
  });

  it("borrar pide confirmación; confirmar llama a DELETE y avisa", async () => {
    mockApi("delete", "/materials/1", {});
    const { user } = setup();
    await screen.findByText("Guía de gramática");
    await user.click(inCard("Guía de gramática", "Eliminar"));
    expect(await screen.findByText("¿Eliminar material?")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /Eliminar/ }).at(-1) as HTMLElement);
    await waitFor(() => expect(callsTo("delete", "/materials/1")).toHaveLength(1));
    expect((await screen.findAllByText("Material eliminado correctamente")).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText("Guía de gramática")).not.toBeInTheDocument());
  });

  it("cancelar el borrado no llama a la API", async () => {
    const { user } = setup();
    await screen.findByText("Guía de gramática");
    await user.click(inCard("Guía de gramática", "Eliminar"));
    await user.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(callsTo("delete", "/materials/1")).toHaveLength(0);
    expect(screen.queryByText("¿Eliminar material?")).not.toBeInTheDocument();
  });

  it("un error al borrar se muestra", async () => {
    mockApiError("delete", "/materials/1", 409, "El material está asignado");
    const { user } = setup();
    await screen.findByText("Guía de gramática");
    await user.click(inCard("Guía de gramática", "Eliminar"));
    await screen.findByText("¿Eliminar material?");
    await user.click(screen.getAllByRole("button", { name: /Eliminar/ }).at(-1) as HTMLElement);
    expect(await screen.findByText("El material está asignado")).toBeInTheDocument();
  });
});

describe("Materiales · huecos de cobertura", () => {
  /** Cambia un <select> a su última opción (distinta de la actual). */
  const pickLast = (sel: HTMLElement) => {
    const s = sel as HTMLSelectElement;
    const opts = Array.from(s.options).map((o) => o.value);
    const value = opts.find((v) => v !== s.value) ?? opts[0];
    fireEvent.change(s, { target: { value } });
    return value;
  };
  async function openForm(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText("Guía de gramática");
    await user.click(screen.getByRole("button", { name: /Nuevo material/ }));
    await screen.findByPlaceholderText("Ej: Guía de gramática B1");
  }

  it("una descripción larga se expande con «Ver más» y se recoge con «Ver menos»", async () => {
    setup([{ ...DOC, description: "Texto largo ".repeat(40) }]);
    await screen.findByText("Guía de gramática");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Ver más" }));
    expect(screen.getByRole("button", { name: "Ver menos" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ver menos" }));
    expect(screen.getByRole("button", { name: "Ver más" })).toBeInTheDocument();
  });

  it("si fallan los materiales, Reintentar los vuelve a pedir", async () => {
    const { user } = setup([], () => mockApiError("get", "/materials/my-materials", 500, "x"));
    const retry = await screen.findByRole("button", { name: /Reintentar/ });
    mockApi("get", "/materials/my-materials", [DOC]);
    await user.click(retry);
    expect(await screen.findByText("Guía de gramática")).toBeInTheDocument();
  });

  it("si fallan los estudiantes, Reintentar los vuelve a pedir y se pueden asignar", async () => {
    const { user } = setup([DOC, VOCAB], () => mockApiError("get", /^\/teachers\/me\/students/, 500, "x"));
    await screen.findByText("Guía de gramática");
    await user.click(inCard("Guía de gramática", "Asignar"));
    const retry = await screen.findByRole("button", { name: /Reintentar/ });
    mockApi("get", /^\/teachers\/me\/students/, STUDENTS);
    await user.click(retry);
    expect(await screen.findByText(/Ana/)).toBeInTheDocument();
  });

  it("editar palabras: quitar una palabra existente y guardar", async () => {
    mockApi("post", "/materials/2/vocabulary", {});
    const { user } = setup();
    await screen.findByText("Guía de gramática");
    await user.click(screen.getByRole("button", { name: "Vocabulario" }));
    await user.click(inCard("Viajes", "Palabras"));
    await screen.findByText("Editar palabras");
    const chip = screen.getAllByText("Avión").find((e) => e.closest("span")?.querySelector("button"))!;
    await user.click(chip.closest("span")!.querySelector("button") as HTMLElement);
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(callsTo("post", "/materials/2/vocabulary")).toHaveLength(1));
    expect(callsTo("post", "/materials/2/vocabulary")[0].body).toEqual({ words: ["Hotel"], language: "" });
  });

  it("editar detalles: descripción, categoría y nivel se envían", async () => {
    mockApi("patch", "/materials/1", DOC);
    const { user } = setup();
    await screen.findByText("Guía de gramática");
    await user.click(inCard("Guía de gramática", "Detalles"));
    await screen.findByPlaceholderText("Título del material");
    fireEvent.change(screen.getByPlaceholderText(/Breve descripción de qué trata/), { target: { value: "Nueva descripción" } });
    const [catSel, levelSel] = screen.getAllByRole("combobox");
    const cat = pickLast(catSel);
    const level = pickLast(levelSel);
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(callsTo("patch", "/materials/1")).toHaveLength(1));
    expect(callsTo("patch", "/materials/1")[0].body).toMatchObject({ description: "Nueva descripción", category: cat, level });
  });

  it("subir documento: categoría, nivel, cambiar de pestaña, clic en la zona de archivo y archivo demasiado grande", async () => {
    const { user, container } = setup();
    await openForm(user);
    const [catSel, levelSel] = screen.getAllByRole("combobox");
    pickLast(catSel);
    pickLast(levelSel);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    await user.click(container.querySelector("div[class*='border-dashed']") as HTMLElement);
    expect(click).toHaveBeenCalled();
    const big = new File(["x"], "enorme.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText("El archivo supera el límite permitido de 10 MB.")).toBeInTheDocument();
    await user.click(screen.getByText("El archivo supera el límite permitido de 10 MB.").closest("div")!.parentElement!.querySelector("button:last-of-type") as HTMLElement);
    await waitFor(() => expect(screen.queryByText("El archivo supera el límite permitido de 10 MB.")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Crear vocabulario" }));
    expect(await screen.findByPlaceholderText("Ej: Vocabulario de viajes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Subir documento" }));
    expect(await screen.findByPlaceholderText("Ej: Guía de gramática B1")).toBeInTheDocument();
  });

  it("crear vocabulario: descripción, nivel y botón + para añadir palabras", async () => {
    mockApi("post", "/materials/", { id: 50 });
    mockApi("post", "/materials/50/vocabulary", {});
    const { user } = setup();
    await openForm(user);
    await user.click(screen.getByRole("button", { name: "Crear vocabulario" }));
    await user.type(await screen.findByPlaceholderText("Ej: Vocabulario de viajes"), "Comida");
    fireEvent.change(screen.getByPlaceholderText(/Breve descripción de este set/), { target: { value: "Platos" } });
    await user.click(screen.getByRole("button", { name: "B2" }));
    await user.type(screen.getByPlaceholderText("Escribe una palabra y presiona Enter..."), "pan");
    const plus = screen.getByPlaceholderText("Escribe una palabra y presiona Enter...").parentElement!.querySelector("button[type='button']") as HTMLElement;
    await user.click(plus);
    expect(screen.getByText("Pan")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Crear set de vocabulario" }));
    await waitFor(() => expect(callsTo("post", "/materials/50/vocabulary")).toHaveLength(1));
    const form = callsTo("post", "/materials/")[0].body as FormData;
    expect(form.get("description")).toBe("Platos");
    expect(form.get("level")).toBe("B2");
  });
});
