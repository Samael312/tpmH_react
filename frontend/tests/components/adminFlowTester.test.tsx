/**
 * Flow tests (admin): enumera los tests de flujo, permite seleccionarlos por test o módulo, lanza corridas (todo,
 * seleccionados, un módulo, uno solo), muestra el progreso con polling y los fallos. Los destructivos solo se
 * pueden correr si se activa su casilla.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import FlowTesterPage from "@/app/(superadmin)/admin/flow-tester/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const ENTRY = (node: string, module: string, name: string, over: Record<string, unknown> = {}) => ({
  node_id: node, module, name, is_destructive: false, technical_description: null, ux_description: null, ...over,
});
const MANIFEST = {
  modules: ["auth", "pagos"],
  tests: [
    ENTRY("t/auth.py::test_login", "auth", "test_login", { technical_description: "POST /auth/login devuelve token", ux_description: "El usuario entra" }),
    ENTRY("t/auth.py::test_register[student]", "auth", "test_register[student]"),
    ENTRY("t/pagos.py::test_compra", "pagos", "test_compra", { is_destructive: true }),
  ],
};
const RES = (node: string, outcome: string, over: Record<string, unknown> = {}) => ({ node_id: node, module: "auth", name: node.split("::")[1], outcome, duration: 0.25, message: null, ...over });
const RUN = (over: Record<string, unknown> = {}) => ({
  run_id: "run-1", status: "completed", include_destructive: false, node_ids: null, started_at: "2026-03-01T10:00:00Z", finished_at: "2026-03-01T10:00:05Z",
  return_code: 0, stderr_tail: null, tests: [], summary: { total: 0, passed: 0, failed: 0, skipped: 0 }, ...over,
});

function setup(o: { manifest?: unknown; run?: unknown; poll?: unknown[] } = {}, extra?: () => void) {
  mockApi("get", "/flow-tests/manifest", o.manifest ?? MANIFEST);
  mockApi("post", "/flow-tests/run", o.run ?? RUN());
  const polls = [...(o.poll ?? [])];
  mockApi("get", /^\/flow-tests\/run-1$/, () => (polls.length > 1 ? polls.shift() : polls[0] ?? o.run ?? RUN()));
  extra?.();
  const view = renderScreen(<FlowTesterPage />, { role: "superadmin" });
  return { ...view, user: userEvent.setup() };
}
const runAll = () => screen.getByRole("button", { name: /Ejecutar todo|Corriendo/ });
const lastRunBody = () => callsTo("post", "/flow-tests/run").at(-1)!.body as { include_destructive: boolean; node_ids: string[] | null };

afterEach(() => { vi.restoreAllMocks(); });

describe("Flow tests · lista", () => {
  it("agrupa por módulo y simplifica los nombres parametrizados", async () => {
    setup();
    expect(await screen.findByText("test_login")).toBeInTheDocument();
    expect(screen.getByText("test_register · student")).toBeInTheDocument();
    expect(screen.getByText("test_compra")).toBeInTheDocument();
    expect(screen.getByText("auth")).toBeInTheDocument();
    expect(screen.getByText("pagos")).toBeInTheDocument();
  });

  it("si falla el manifiesto avisa y «Reintentar» lo vuelve a pedir", async () => {
    const { user } = setup({}, () => mockApiError("get", "/flow-tests/manifest", 500, "Backend caído"));
    expect(await screen.findByText("No se pudo enumerar los tests")).toBeInTheDocument();
    const before = callsTo("get", "/flow-tests/manifest").length;
    await user.click(screen.getByRole("button", { name: /Reintentar/ }));
    await waitFor(() => expect(callsTo("get", "/flow-tests/manifest").length).toBeGreaterThan(before));
  });

  it("el módulo se puede plegar y desplegar", async () => {
    const { user } = setup();
    await screen.findByText("test_login");
    const header = screen.getByText("auth").closest("div")!.parentElement as HTMLElement;
    await user.click(within(header).getAllByRole("button")[0]);
    expect(screen.queryByText("test_login")).not.toBeInTheDocument();
    await user.click(within(header).getAllByRole("button")[0]);
    expect(await screen.findByText("test_login")).toBeInTheDocument();
  });

  it("la descripción técnica y de usuario se abre y se cierra; sin ninguna lo indica", async () => {
    const { user } = setup();
    await screen.findByText("test_login");
    const infos = screen.getAllByTitle("Ver descripción técnica y de usuario");
    await user.click(infos[0]);
    expect(await screen.findByText(/POST \/auth\/login devuelve token/)).toBeInTheDocument();
    expect(screen.getByText(/El usuario entra/)).toBeInTheDocument();
    await user.click(infos[0]);
    expect(screen.queryByText(/El usuario entra/)).not.toBeInTheDocument();
    await user.click(infos[1]);
    expect(await screen.findByText("Sin descripción disponible para este test.")).toBeInTheDocument();
  });
});

describe("Flow tests · selección y destructivos", () => {
  it("el test destructivo está bloqueado hasta activar su casilla", async () => {
    const { user } = setup();
    await screen.findByText("test_compra");
    const box = screen.getByTitle(/Activa 'Incluir tests destructivos'/) as HTMLInputElement;
    expect(box).toBeDisabled();
    expect(screen.getAllByTitle("Ejecutar solo este test").at(-1)).toBeDisabled();
    await user.click(screen.getAllByRole("checkbox")[0]);
    expect(box).toBeEnabled();
  });

  it("seleccionar tests muestra «Ejecutar seleccionados (n)» y apagar destructivos los quita de la selección", async () => {
    const { user } = setup();
    await screen.findByText("test_login");
    const destructive = screen.getAllByRole("checkbox")[0];
    await user.click(destructive);
    const boxes = screen.getAllByRole("checkbox");
    const testBoxes = boxes.filter((b) => !/destructivos/.test(b.closest("label")?.textContent ?? ""));
    await user.click(testBoxes.find((b) => b.getAttribute("title") === null && b !== destructive && (b.closest("div") as HTMLElement).textContent?.includes("test_login"))!);
    await user.click(screen.getAllByRole("checkbox").find((b) => (b.closest("div") as HTMLElement).textContent === "test_compra" || (b.closest("div") as HTMLElement).textContent?.startsWith("test_compra"))!);
    expect(await screen.findByRole("button", { name: /Ejecutar seleccionados \(2\)/ })).toBeInTheDocument();
    await user.click(destructive);
    expect(await screen.findByRole("button", { name: /Ejecutar seleccionados \(1\)/ })).toBeInTheDocument();
  });

  it("la casilla del módulo marca y desmarca todos sus tests ejecutables", async () => {
    const { user } = setup();
    await screen.findByText("test_login");
    const moduleBox = screen.getByText("auth").closest("div")!.parentElement!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await user.click(moduleBox);
    expect(await screen.findByRole("button", { name: /Ejecutar seleccionados \(2\)/ })).toBeInTheDocument();
    await user.click(moduleBox);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Ejecutar seleccionados/ })).not.toBeInTheDocument());
  });
});

describe("Flow tests · correr", () => {
  it("«Ejecutar todo» manda solo los no destructivos y muestra «Todo verde»", async () => {
    const { user } = setup({ run: RUN({ tests: [RES("t/auth.py::test_login", "passed"), RES("t/auth.py::test_register[student]", "passed")], summary: { total: 2, passed: 2, failed: 0, skipped: 0 } }) });
    await screen.findByText("test_login");
    await user.click(runAll());
    await waitFor(() => expect(callsTo("post", "/flow-tests/run")).toHaveLength(1));
    expect(lastRunBody()).toEqual({ include_destructive: false, node_ids: null });
    expect(await screen.findByText("Todo verde")).toBeInTheDocument();
    expect(screen.getByText("2 ok")).toBeInTheDocument();
    expect(screen.getAllByText("250ms").length).toBe(2);
  });

  it("con fallos y saltados los cuenta y deja ver el error de cada test fallado", async () => {
    const { user } = setup({ run: RUN({
      tests: [RES("t/auth.py::test_login", "failed", { message: "AssertionError: 401 != 200", duration: 1.5 }), RES("t/auth.py::test_register[student]", "skipped", { message: "sin entorno" })],
      summary: { total: 2, passed: 0, failed: 1, skipped: 1 }, stderr_tail: "Traceback...",
    }) });
    await screen.findByText("test_login");
    await user.click(runAll());
    expect(await screen.findByText("Con fallos")).toBeInTheDocument();
    expect(screen.getAllByText(/1 fallos/).length).toBeGreaterThan(0);
    expect(screen.getByText("1 saltados")).toBeInTheDocument();
    expect(screen.getByText("1.50s")).toBeInTheDocument();
    expect(screen.getByText("Salida de error del proceso")).toBeInTheDocument();
    expect(screen.getByText("sin entorno")).toBeInTheDocument();
    expect(screen.queryByText(/AssertionError/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ver error" }));
    expect(await screen.findByText(/AssertionError: 401 != 200/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ver error" }));
    expect(screen.queryByText(/AssertionError/)).not.toBeInTheDocument();
  });

  it("una corrida en curso se vuelve a consultar hasta terminar y muestra el progreso", async () => {
    const running = RUN({ status: "running", finished_at: null, tests: [RES("t/auth.py::test_login", "passed")], summary: { total: 1, passed: 1, failed: 0, skipped: 0 } });
    const done = RUN({ tests: [RES("t/auth.py::test_login", "passed"), RES("t/auth.py::test_register[student]", "passed")], summary: { total: 2, passed: 2, failed: 0, skipped: 0 } });
    const { user } = setup({ run: running, poll: [running, done] });
    await screen.findByText("test_login");
    await user.click(runAll());
    expect(await screen.findByText("En curso")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Corriendo..." })).toBeDisabled();
    expect(await screen.findByText("Todo verde", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(runAll()).toBeEnabled();
  });

  it("«Ejecutar seleccionados» manda solo los elegidos", async () => {
    const { user } = setup();
    await screen.findByText("test_login");
    const moduleBox = screen.getByText("auth").closest("div")!.parentElement!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await user.click(moduleBox);
    await user.click(await screen.findByRole("button", { name: /Ejecutar seleccionados \(2\)/ }));
    await waitFor(() => expect(callsTo("post", "/flow-tests/run")).toHaveLength(1));
    expect(lastRunBody().node_ids).toEqual(["t/auth.py::test_login", "t/auth.py::test_register[student]"]);
  });

  it("el botón del módulo y el de un solo test corren solo eso", async () => {
    const { user } = setup();
    await screen.findByText("test_login");
    await user.click(screen.getAllByTitle("Ejecutar solo este módulo")[0]);
    await waitFor(() => expect(callsTo("post", "/flow-tests/run")).toHaveLength(1));
    expect(lastRunBody().node_ids).toEqual(["t/auth.py::test_login", "t/auth.py::test_register[student]"]);
    await user.click(screen.getAllByTitle("Ejecutar solo este test")[0]);
    await waitFor(() => expect(callsTo("post", "/flow-tests/run")).toHaveLength(2));
    expect(lastRunBody().node_ids).toEqual(["t/auth.py::test_login"]);
  });

  it("con destructivos activados «Ejecutar todo» los incluye", async () => {
    const { user } = setup();
    await screen.findByText("test_login");
    await user.click(screen.getAllByRole("checkbox")[0]);
    await user.click(runAll());
    await waitFor(() => expect(callsTo("post", "/flow-tests/run")).toHaveLength(1));
    expect(lastRunBody()).toEqual({ include_destructive: true, node_ids: null });
  });

  it("si el servidor rechaza lanzar la corrida lo avisa", async () => {
    const { user } = setup({}, () => mockApiError("post", "/flow-tests/run", 409, "Ya hay una corrida en curso"));
    await screen.findByText("test_login");
    await user.click(runAll());
    expect(await screen.findByText("No se pudo ejecutar la suite")).toBeInTheDocument();
    expect(screen.getByText("Ya hay una corrida en curso")).toBeInTheDocument();
  });

  it("si falla la consulta de la corrida también lo avisa y deja de consultar", async () => {
    const running = RUN({ status: "running", finished_at: null });
    const { user } = setup({ run: running }, () => mockApiError("get", /^\/flow-tests\/run-1$/, 500, "Se perdió la corrida"));
    await screen.findByText("test_login");
    await user.click(runAll());
    expect(await screen.findByText("Se perdió la corrida", {}, { timeout: 4000 })).toBeInTheDocument();
  });
});
