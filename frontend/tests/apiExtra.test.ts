import { beforeEach, describe, expect, it, vi } from "vitest";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

const setUser = vi.fn();
const state = { user: null as null | Record<string, unknown>, logout: vi.fn(), setUser };
vi.mock("@/store/authStore", () => ({ useAuthStore: { getState: () => state } }));
const report = vi.fn();
vi.mock("@/lib/errorReporting", () => ({ reportFrontendError: (...a: unknown[]) => report(...a) }));

import api from "@/lib/api";

function adapterReturning(status: number, data: unknown = {}) {
  api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const response = { data, status, statusText: "", headers: {}, config };
    if (status >= 400) throw new AxiosError("fallo de red", String(status), config, null, response);
    return response;
  };
}

beforeEach(() => {
  setUser.mockClear(); report.mockClear();
  state.user = null;
  vi.stubGlobal("window", { location: { pathname: "/dashboard/classes", href: "" } });
});

describe("lib/api.ts — sincroniza al usuario actual", () => {
  it("una respuesta con los datos del mismo usuario actualiza el store", async () => {
    state.user = { id: 5, username: "ana", role: "student", name: "Vieja" };
    adapterReturning(200, { id: 5, username: "ana", role: "student", name: "Nueva" });
    await api.get("/users/me");
    expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ id: 5, name: "Nueva" }));
  });

  it("los datos de otro usuario no tocan el store", async () => {
    state.user = { id: 5, username: "ana", role: "student" };
    adapterReturning(200, { id: 9, username: "luis", role: "student" });
    await api.get("/users/9");
    expect(setUser).not.toHaveBeenCalled();
  });

  it("sin usuario en el store no hace nada aunque la respuesta parezca un usuario", async () => {
    adapterReturning(200, { id: 5, username: "ana", role: "student" });
    await api.get("/users/me");
    expect(setUser).not.toHaveBeenCalled();
  });

  it("una respuesta sin rol no se toma por un usuario", async () => {
    state.user = { id: 5, username: "ana", role: "student" };
    adapterReturning(200, { id: 5, username: "ana" });
    await api.get("/x");
    expect(setUser).not.toHaveBeenCalled();
  });
});

describe("lib/api.ts — informa de los fallos", () => {
  it("un 4xx se informa como aviso con la URL y el método", async () => {
    adapterReturning(422, { detail: "Datos inválidos" });
    await expect(api.post("/classes", {})).rejects.toBeTruthy();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      level: "warning", status_code: 422, screen: "/dashboard/classes", extra: { url: "/classes", method: "post" },
    }));
  });

  it("un 5xx se informa como error", async () => {
    adapterReturning(500, {});
    await expect(api.get("/classes")).rejects.toBeTruthy();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ level: "error", status_code: 500 }));
  });

  it("un fallo sin respuesta (red) se informa como error sin código", async () => {
    api.defaults.adapter = async (config: InternalAxiosRequestConfig) => { throw new AxiosError("Network Error", "ERR_NETWORK", config); };
    await expect(api.get("/classes")).rejects.toBeTruthy();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ level: "error", status_code: undefined }));
  });

  it("un 401 de login no se informa", async () => {
    adapterReturning(401, {});
    await expect(api.post("/auth/login", {})).rejects.toBeTruthy();
    expect(report).not.toHaveBeenCalled();
  });
});
void axios;
