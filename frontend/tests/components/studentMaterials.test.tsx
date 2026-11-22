/**
 * Materiales del alumno: lista con búsqueda y filtro por categoría, progreso (completar / volver a pendiente),
 * descripción expandible y el audio del vocabulario (palabra suelta y «Escuchar todo» en secuencia).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, act } from "@testing-library/react";
import MaterialsPage from "@/app/(student)/dashboard/materials/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const MAT = (id: number, over: Record<string, unknown> = {}, mat: Record<string, unknown> = {}) => ({
  id, material_id: id * 10, student_id: 1, progress: "pending", assigned_at: "2026-02-01T12:00:00Z",
  material: { id: id * 10, title: `Material ${id}`, description: undefined, category: "Grammar", level: "A1", file_url: undefined, vocabulary_words: undefined, ...mat },
  ...over,
});
const VOCAB = MAT(5, {}, { title: "Frutas", category: "Vocabulary", level: "B2", vocabulary_words: ["manzana", "pera", "uva"] });

function setup(list: unknown[] = [MAT(1), MAT(2, { progress: "completed" }, { title: "Lectura 1", category: "Reading", level: "C1", file_url: "https://f/doc.pdf" })], extra?: () => void) {
  mockApi("get", "/materials/student/my-materials", list);
  extra?.();
  const view = renderScreen(<MaterialsPage />, { role: "student" });
  return { ...view, user: userEvent.setup() };
}

let play: ReturnType<typeof vi.fn>;
beforeEach(() => {
  play = vi.fn(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play as never);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });
const audio = () => document.querySelector("audio") as HTMLAudioElement;

describe("Materiales (alumno) · lista", () => {
  it("lista los materiales con nivel, categoría y progreso general", async () => {
    setup();
    expect(await screen.findByText("Material 1")).toBeInTheDocument();
    expect(screen.getByText("Lectura 1")).toBeInTheDocument();
    expect(screen.getByText("A1")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Documento/ })).toHaveAttribute("href", "https://f/doc.pdf");
  });

  it("un material sin título ni nivel usa los valores por defecto", async () => {
    setup([MAT(1, {}, { title: "", level: undefined })]);
    expect(await screen.findByText("Sin título")).toBeInTheDocument();
  });

  it("un nivel desconocido sigue mostrándose", async () => {
    setup([MAT(1, {}, { level: "Z9" })]);
    expect(await screen.findByText("Z9")).toBeInTheDocument();
  });

  it("busca por título y avisa si nada coincide", async () => {
    const { user } = setup();
    await screen.findByText("Material 1");
    await user.type(screen.getByPlaceholderText("Buscar por título o palabra clave..."), "lectura");
    expect(screen.queryByText("Material 1")).not.toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText("Buscar por título o palabra clave..."));
    await user.type(screen.getByPlaceholderText("Buscar por título o palabra clave..."), "zzz");
    expect(await screen.findByText(/No hay coincidencias/)).toBeInTheDocument();
  });

  it("filtra por categoría y «Todos» lo deshace", async () => {
    const { user } = setup();
    await screen.findByText("Material 1");
    await user.click(screen.getByRole("button", { name: "Reading" }));
    expect(screen.queryByText("Material 1")).not.toBeInTheDocument();
    expect(screen.getByText("Lectura 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Todos" }));
    expect(await screen.findByText("Material 1")).toBeInTheDocument();
  });

  it("si falla la carga ofrece reintentar", async () => {
    const { user } = setup([], () => mockApiError("get", "/materials/student/my-materials", 500, "x"));
    const retry = await screen.findByRole("button", { name: /Reintentar/ });
    const before = callsTo("get", "/materials/student/my-materials").length;
    await user.click(retry);
    await waitFor(() => expect(callsTo("get", "/materials/student/my-materials").length).toBeGreaterThan(before));
  });

  it("la descripción larga se expande y se contrae", async () => {
    const { user } = setup([MAT(1, {}, { description: "Una descripción muy larga de ejemplo" })]);
    await user.click(await screen.findByRole("button", { name: "Ver más" }));
    expect(screen.getByRole("button", { name: "Ver menos" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ver menos" }));
    expect(screen.getByRole("button", { name: "Ver más" })).toBeInTheDocument();
  });
});

describe("Materiales (alumno) · progreso", () => {
  it("«Marcar listo» lo completa y avisa", async () => {
    mockApi("patch", "/materials/student/1/progress", MAT(1, { progress: "completed" }));
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Marcar listo/ }));
    await waitFor(() => expect(callsTo("patch", "/materials/student/1/progress")).toHaveLength(1));
    expect(callsTo("patch", "/materials/student/1/progress")[0].body).toEqual({ progress: "completed" });
    expect(await screen.findByText("Material marcado como completado")).toBeInTheDocument();
  });

  it("«Completado» vuelve a pendiente", async () => {
    mockApi("patch", "/materials/student/2/progress", MAT(2, { progress: "pending" }));
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Completado/ }));
    await waitFor(() => expect(callsTo("patch", "/materials/student/2/progress")).toHaveLength(1));
    expect(callsTo("patch", "/materials/student/2/progress")[0].body).toEqual({ progress: "pending" });
    expect(await screen.findByText("Material marcado como pendiente")).toBeInTheDocument();
  });

  it("un error al guardar se avisa", async () => {
    const { user } = setup(undefined, () => mockApiError("patch", "/materials/student/1/progress", 500, "Sin conexión con el servidor"));
    await user.click(await screen.findByRole("button", { name: /Marcar listo/ }));
    expect(await screen.findByText("Sin conexión con el servidor")).toBeInTheDocument();
  });
});

describe("Materiales (alumno) · vocabulario con audio", () => {
  const urls = { manzana: "https://a/m.mp3", pera: null, uva: "https://a/u.mp3" };

  it("una palabra pide el audio una vez, lo reproduce y lo marca mientras suena", async () => {
    mockApi("post", "/tts/vocabulary/50", { audio_urls: urls });
    const { user } = setup([VOCAB]);
    await user.click(await screen.findByRole("button", { name: /manzana/ }));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(audio().src).toBe("https://a/m.mp3");
    expect(callsTo("post", "/tts/vocabulary/50")).toHaveLength(1);
    act(() => { audio().onended?.(new Event("ended")); });
    await user.click(screen.getByRole("button", { name: /uva/ }));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(callsTo("post", "/tts/vocabulary/50")).toHaveLength(1); // cacheado
  });

  it("una palabra sin audio no reproduce nada", async () => {
    mockApi("post", "/tts/vocabulary/50", { audio_urls: urls });
    const { user } = setup([VOCAB]);
    await user.click(await screen.findByRole("button", { name: /pera/ }));
    await waitFor(() => expect(callsTo("post", "/tts/vocabulary/50")).toHaveLength(1));
    expect(play).not.toHaveBeenCalled();
  });

  it("si falla generar el audio avisa", async () => {
    mockApiError("post", "/tts/vocabulary/50", 500, "TTS caído");
    const { user } = setup([VOCAB]);
    await user.click(await screen.findByRole("button", { name: /manzana/ }));
    expect(await screen.findByText("TTS caído")).toBeInTheDocument();
    expect(play).not.toHaveBeenCalled();
  });

  it("«Escuchar todo» encadena las palabras, salta las que no tienen audio y termina solo", async () => {
    mockApi("post", "/tts/vocabulary/50", { audio_urls: urls });
    const { user } = setup([VOCAB]);
    await user.click(await screen.findByRole("button", { name: /Escuchar todo/ }));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(audio().src).toBe("https://a/m.mp3");
    expect(screen.getByRole("button", { name: /Detener/ })).toBeInTheDocument();
    act(() => { audio().onended?.(new Event("ended")); }); // pasa a «pera» (sin audio) y salta a «uva»
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(audio().src).toBe("https://a/u.mp3");
    act(() => { audio().onended?.(new Event("ended")); });
    await waitFor(() => expect(screen.getByRole("button", { name: /Escuchar todo/ })).toBeInTheDocument());
  });

  it("«Detener» corta la secuencia", async () => {
    mockApi("post", "/tts/vocabulary/50", { audio_urls: urls });
    const { user } = setup([VOCAB]);
    await user.click(await screen.findByRole("button", { name: /Escuchar todo/ }));
    await user.click(await screen.findByRole("button", { name: /Detener/ }));
    expect(await screen.findByRole("button", { name: /Escuchar todo/ })).toBeInTheDocument();
  });

  it("elegir una palabra durante «Escuchar todo» cancela la secuencia", async () => {
    mockApi("post", "/tts/vocabulary/50", { audio_urls: urls });
    const { user } = setup([VOCAB]);
    await user.click(await screen.findByRole("button", { name: /Escuchar todo/ }));
    await screen.findByRole("button", { name: /Detener/ });
    await user.click(screen.getByRole("button", { name: /uva/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Escuchar todo/ })).toBeInTheDocument());
  });

  it("un material de vocabulario sin palabras se trata como material normal", async () => {
    setup([MAT(5, {}, { title: "Vacío", category: "Vocabulary", vocabulary_words: [] })]);
    await screen.findByText("Vacío");
    expect(screen.queryByRole("button", { name: /Escuchar todo/ })).not.toBeInTheDocument();
  });
});
