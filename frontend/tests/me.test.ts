import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ default: { get } }));

import { fetchMe } from "@/lib/me";

describe("fetchMe", () => {
  it("varias llamadas simultáneas comparten UNA sola petición a /users/me", async () => {
    get.mockReset();
    get.mockImplementation(() => new Promise((res) => setTimeout(() => res({ data: { id: 1 } }), 10)));
    const qc = new QueryClient();
    const [a, b, c] = await Promise.all([fetchMe(qc), fetchMe(qc), fetchMe(qc)]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/users/me");
    expect([a, b, c]).toEqual([{ id: 1 }, { id: 1 }, { id: 1 }]);
  });

  it("una llamada posterior pide dato fresco (no queda obsoleto tras un PATCH)", async () => {
    get.mockReset();
    get.mockResolvedValueOnce({ data: { name: "Ana" } }).mockResolvedValueOnce({ data: { name: "Anita" } });
    const qc = new QueryClient();
    expect(await fetchMe(qc)).toEqual({ name: "Ana" });
    expect(await fetchMe(qc)).toEqual({ name: "Anita" });
    expect(get).toHaveBeenCalledTimes(2);
  });
});
