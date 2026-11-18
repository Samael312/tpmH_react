import { beforeEach, describe, expect, it, vi } from "vitest";

// Nota: en Node no hay localStorage y zustand/persist imprime un aviso inofensivo; el estado en memoria funciona igual.
const chat = vi.hoisted(() => ({ reset: vi.fn() }));
vi.mock("@/store/chatStore", () => ({ useChatStore: { getState: () => chat } }));

import { useAuthStore, type User } from "@/store/authStore";

const student: User = { username: "ana", name: "Ana", surname: "P", email: "a@x.com", role: "student", timezone: "Europe/Madrid" };

beforeEach(() => {
  useAuthStore.setState({ user: null, isLoading: false });
  chat.reset.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
});

describe("authStore", () => {
  it("login guarda el usuario y apaga isLoading (el token ya no se guarda en el navegador)", () => {
    useAuthStore.setState({ isLoading: true });
    useAuthStore.getState().login("token-ignorado", student);
    const s = useAuthStore.getState();
    expect(s.user).toEqual(student);
    expect(s.isLoading).toBe(false);
    expect(JSON.stringify(s.user)).not.toContain("token-ignorado");
  });

  it("logout: borra el usuario, vacía el chat y revoca la sesión en el servidor con cookies", () => {
    useAuthStore.getState().login("t", student);
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().user).toBeNull();
    expect(chat.reset).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toMatch(/\/auth\/logout$/);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
  });

  it("logout cierra la sesión local aunque el servidor no responda", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("sin red"); }));
    useAuthStore.getState().login("t", student);
    expect(() => useAuthStore.getState().logout()).not.toThrow();
    expect(useAuthStore.getState().user).toBeNull();
    await Promise.resolve();
  });

  it("logout devuelve una promesa que solo se resuelve cuando el POST terminó (quien navega debe esperarla) y usa keepalive", async () => {
    let finish!: () => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((res) => { finish = () => res({ ok: true }); })));
    let done = false;
    const p = useAuthStore.getState().logout().then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await p;
    expect(done).toBe(true);
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init).toMatchObject({ keepalive: true });
  });

  it("setUser sustituye los datos y setHasHydrated marca la hidratación", () => {
    useAuthStore.getState().setUser({ ...student, name: "Anita" });
    expect(useAuthStore.getState().user?.name).toBe("Anita");
    useAuthStore.getState().setHasHydrated(true);
    expect(useAuthStore.getState().hasHydrated).toBe(true);
  });
});
