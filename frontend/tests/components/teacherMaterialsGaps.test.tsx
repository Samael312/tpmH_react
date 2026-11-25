/**
 * Materiales del profesor · ramas que las otras pruebas no recorren: iconos por tipo de archivo, insignia de nivel
 * desconocido, estudiantes con avatar y los que ya están en el grupo elegido, y el editor de vocabulario en sus bordes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import MaterialsPage from "@/app/(teacher)/teacher/materials/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const doc = (id: number, title: string, over: Record<string, unknown> = {}) => ({
  id, title, description: "d", category: "Guides", level: "B1", file_url: "https://cdn.example.com/x.pdf",
  file_type: "application/pdf", created_at: "2026-01-01T00:00:00Z", vocabulary_words: null, ...over,
});
const VOCAB = {
  id: 2, title: "Viajes", description: null, category: "Vocabulary", level: "A2",
  file_url: null, file_type: null, created_at: "2026-01-02T00:00:00Z", vocabulary_words: ["Avión"],
};
const STUDENTS = [
  { id: 7, name: "Ana", surname: "Pérez", username: "ana", avatar: "https://cdn.test/ana.png" },
  { id: 8, name: "Luis", surname: "Gómez", username: "luis", avatar: null },
];

function setup(materials: unknown[], extra?: () => void) {
  mockApi("get", "/materials/my-materials", materials);
  mockApi("get", /^\/teachers\/me\/students/, STUDENTS);
  mockApi("get", /^\/cohorts\/teacher/, []);
  extra?.();
  const view = renderScreen(<MaterialsPage />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}
const inCard = (title: string, name: string) => within(screen.getByText(title).closest("[class*='p-5']") as HTMLElement).getByRole("button", { name });
const assignButton = () => screen.getAllByRole("button", { name: /Asignar/ }).at(-1) as HTMLElement;

afterEach(() => { vi.restoreAllMocks(); });

describe("Materiales · tarjetas", () => {
  it("el icono depende del tipo de archivo (imagen, PDF, otro) y la insignia de un nivel desconocido sale neutra", async () => {
    setup([
      doc(1, "Foto", { file_url: "https://cdn.example.com/a.PNG", level: "Z9" }),
      doc(2, "Informe", { file_url: "https://cdn.example.com/b.pdf" }),
      doc(3, "Hoja", { file_url: "https://cdn.example.com/c.xlsx", level: "C1" }),
      doc(4, "Sin ruta", { file_url: null, description: null }),
    ]);
    await screen.findByText("Foto");
    const iconOf = (title: string) => (screen.getByText(title).closest("[class*='p-5']") as HTMLElement).querySelector("svg[class*='w-6 h-6']")!.getAttribute("class");
    expect(iconOf("Foto")).toContain("text-blue-500");
    expect(iconOf("Informe")).toContain("text-rose-500");
    expect(iconOf("Hoja")).toContain("text-slate-400");
    expect(iconOf("Sin ruta")).toContain("text-slate-400");
    expect(screen.getByText("Z9")).toHaveClass("bg-slate-100");
    expect(screen.getByText("C1")).toHaveClass("bg-purple-100");
    expect(screen.getByText("Sin descripción")).toBeInTheDocument();
  });

  it("un set de vocabulario muestra su recuento de palabras", async () => {
    const { user } = setup([doc(1, "Guía"), VOCAB]);
    await screen.findByText("Guía");
    await user.click(screen.getByRole("button", { name: "Vocabulario" }));
    expect(await screen.findByText("1 palabras")).toBeInTheDocument();
  });

  it("buscar sin coincidencias no deja tarjetas", async () => {
    const { user } = setup([doc(1, "Guía")]);
    await screen.findByText("Guía");
    await user.type(screen.getByPlaceholderText(/Buscar/i), "zzz");
    expect(screen.queryByText("Guía")).not.toBeInTheDocument();
  });
});

describe("Materiales · asignar, casos de borde", () => {
  const openAssign = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByText("Guía");
    await user.click(inCard("Guía", "Asignar"));
    await screen.findByText("Asignar material");
  };

  it("un estudiante con avatar muestra la foto y uno sin avatar no", async () => {
    const { user } = setup([doc(1, "Guía")]);
    await openAssign(user);
    await screen.findByText(/Ana/);
    expect(document.querySelector("img[alt='Ana']")).not.toBeNull();
    expect(document.querySelector("img[alt='Luis']")).toBeNull();
  });

  it("una búsqueda sin resultados lo dice", async () => {
    const { user } = setup([doc(1, "Guía")]);
    await openAssign(user);
    await user.type(await screen.findByPlaceholderText("Buscar por nombre o usuario..."), "qqq");
    expect(await screen.findByText(/Sin resultados para/)).toBeInTheDocument();
  });

  it("marcar y desmarcar un estudiante deja la selección vacía y no asigna", async () => {
    mockApi("post", "/materials/1/assign", {});
    const { user } = setup([doc(1, "Guía")]);
    await openAssign(user);
    await user.click(await screen.findByText(/Ana/));
    await user.click(screen.getByText(/Ana/));
    await user.click(assignButton());
    expect(callsTo("post", "/materials/1/assign")).toHaveLength(0);
  });

  it("los integrantes del grupo elegido salen marcados como «Ya está en el grupo» y se pueden seleccionar", async () => {
    mockApi("post", "/materials/1/assign", {});
    const { user } = setup([doc(1, "Guía")], () => {
      mockApi("get", /^\/cohorts\/teacher/, [{ id: 5, package_name: null, current_students: 1, status: "in_progress" }]);
      mockApi("get", "/cohorts/5/members", [{ student_id: 8, student_name: "Luis Gómez" }]);
    });
    await openAssign(user);
    await user.selectOptions(await screen.findByRole("combobox"), "5");
    expect(await screen.findByText("Ya está en el grupo")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Grupo — 1 alumno$/ })).toBeInTheDocument();
    await user.click(screen.getByText(/Luis/));
    expect(screen.queryByText("Ya está en el grupo")).not.toBeInTheDocument();
    await user.click(assignButton());
    await waitFor(() => expect(callsTo("post", "/materials/1/assign")).toHaveLength(1));
    expect(callsTo("post", "/materials/1/assign")[0].body).toMatchObject({ student_ids: [8], cohort_id: 5 });
  });

  it("los grupos cancelados o completados no se ofrecen y volver a «sin grupo» limpia la elección", async () => {
    const { user } = setup([doc(1, "Guía")], () => mockApi("get", /^\/cohorts\/teacher/, [
      { id: 5, package_name: "Vivo", current_students: 2, status: "filling" },
      { id: 6, package_name: "Muerto", current_students: 2, status: "cancelled" },
      { id: 7, package_name: "Hecho", current_students: 2, status: "completed" },
    ]));
    await openAssign(user);
    const select = await screen.findByRole("combobox");
    await waitFor(() => expect(screen.getByRole("option", { name: /Vivo/ })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: /Muerto|Hecho/ })).not.toBeInTheDocument();
    await user.selectOptions(select, "5");
    await user.selectOptions(select, "");
    expect((select as HTMLSelectElement).value).toBe("");
  });
});

describe("Materiales · editor de vocabulario, casos de borde", () => {
  const openEditor = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByText("Guía");
    await user.click(screen.getByRole("button", { name: "Vocabulario" }));
    await user.click(inCard("Viajes", "Palabras"));
    await screen.findByText("Editar palabras");
  };
  const chipsOf = (word: string) => screen.getAllByText(word).filter((e) => e.closest("span")?.querySelector("button"));

  it("una palabra repetida o vacía no se añade", async () => {
    const { user } = setup([doc(1, "Guía"), VOCAB]);
    await openEditor(user);
    const input = screen.getByPlaceholderText(/palabra/i);
    await user.type(input, "Avión{enter}");
    await user.type(input, "   {enter}");
    expect(chipsOf("Avión")).toHaveLength(1);
  });

  it("quitar todas las palabras muestra «Sin palabras todavía»", async () => {
    const { user } = setup([doc(1, "Guía"), VOCAB]);
    await openEditor(user);
    await user.click(chipsOf("Avión")[0].closest("span")!.querySelector("button") as HTMLElement);
    expect(await screen.findByText("Sin palabras todavía")).toBeInTheDocument();
  });

  it("un error al guardar las palabras se avisa y el editor sigue abierto", async () => {
    mockApiError("post", "/materials/2/vocabulary", 500, "Servidor caído");
    const { user } = setup([doc(1, "Guía"), VOCAB]);
    await openEditor(user);
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    expect(await screen.findByText("Servidor caído")).toBeInTheDocument();
    expect(screen.getByText("Editar palabras")).toBeInTheDocument();
  });
});
