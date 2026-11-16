import { beforeEach, describe, expect, it, vi } from "vitest";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

const logout = vi.fn();
vi.mock("@/store/authStore", () => ({
  useAuthStore: { getState: () => ({ user: null, logout, setUser: vi.fn() }) },
}));
vi.mock("@/lib/errorReporting", () => ({ reportFrontendError: vi.fn() }));

import api from "@/lib/api";

type Handler = (config: InternalAxiosRequestConfig) => { status: number; data?: unknown };

function useAdapter(handler: Handler) {
  const adapter = async (config: InternalAxiosRequestConfig) => {
    const r = handler(config);
    const response = { data: r.data ?? {}, status: r.status, statusText: "", headers: {}, config };
    if (r.status >= 400) throw new AxiosError("fail", String(r.status), config, null, response);
    return response;
  };
  api.defaults.adapter = adapter;
  axios.defaults.adapter = adapter; // el refresh usa el axios global
}

const isRefresh = (c: InternalAxiosRequestConfig) => !!c.url?.includes("/auth/refresh");

beforeEach(() => {
  logout.mockClear();
  vi.stubGlobal("window", { location: { pathname: "/dashboard", href: "" } });
});

describe("lib/api.ts — sesión por cookie y refresh", () => {
  it("envía credenciales (cookies) y ninguna cabecera Authorization", async () => {
    let seen: InternalAxiosRequestConfig | undefined;
    useAdapter((c) => {
      seen = c;
      return { status: 200 };
    });
    await api.get("/users/me");
    expect(seen?.withCredentials).toBe(true);
    expect(seen?.headers.get("Authorization")).toBeFalsy();
  });

  it("un 401 renueva la sesión una vez y reintenta la petición", async () => {
    let calls = 0;
    let refreshes = 0;
    useAdapter((c) => {
      if (isRefresh(c)) {
        refreshes++;
        return { status: 200 };
      }
      return ++calls === 1 ? { status: 401 } : { status: 200, data: { ok: true } };
    });
    const r = await api.get("/classes");
    expect(r.data).toEqual({ ok: true });
    expect(refreshes).toBe(1);
    expect(logout).not.toHaveBeenCalled();
  });

  it("varios 401 simultáneos comparten UN solo refresh (el token rota)", async () => {
    let refreshes = 0;
    const served = new Set<string>();
    useAdapter((c) => {
      if (isRefresh(c)) {
        refreshes++;
        return { status: 200 };
      }
      const key = c.url ?? "";
      if (!served.has(key)) {
        served.add(key);
        return { status: 401 };
      }
      return { status: 200 };
    });
    await Promise.all([api.get("/a"), api.get("/b"), api.get("/c")]);
    expect(refreshes).toBe(1);
  });

  it("si el refresh falla: logout y vuelta al login", async () => {
    useAdapter(() => ({ status: 401 }));
    await expect(api.get("/classes")).rejects.toBeTruthy();
    expect(logout).toHaveBeenCalledTimes(1);
    expect((window as unknown as { location: { href: string } }).location.href).toBe("/login");
  });

  it("un 401 en /auth/login (credenciales malas) no intenta refresh ni cierra sesión", async () => {
    let refreshes = 0;
    useAdapter((c) => {
      if (isRefresh(c)) refreshes++;
      return { status: 401 };
    });
    await expect(api.post("/auth/login", {})).rejects.toBeTruthy();
    expect(refreshes).toBe(0);
    expect(logout).not.toHaveBeenCalled();
  });

  it("no reintenta en bucle: segundo 401 tras un refresh bueno cierra sesión", async () => {
    let refreshes = 0;
    useAdapter((c) => {
      if (isRefresh(c)) {
        refreshes++;
        return { status: 200 };
      }
      return { status: 401 };
    });
    await expect(api.get("/classes")).rejects.toBeTruthy();
    expect(refreshes).toBe(1);
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
