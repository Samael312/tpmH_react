import { afterEach, describe, expect, it, vi } from "vitest";
import { visiblePoll } from "@/lib/polling";

afterEach(() => vi.unstubAllGlobals());

describe("lib/polling", () => {
  it("visiblePoll sondea con la pestaña visible y se detiene con la pestaña oculta", () => {
    vi.stubGlobal("document", { visibilityState: "visible" });
    expect(visiblePoll(60000)()).toBe(60000);
    vi.stubGlobal("document", { visibilityState: "hidden" });
    expect(visiblePoll(60000)()).toBe(false);
  });
});
