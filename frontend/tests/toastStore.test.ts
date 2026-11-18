import { beforeEach, describe, expect, it } from "vitest";
import { toast, useToastStore } from "@/store/toastStore";

beforeEach(() => {
  useToastStore.getState().clear();
});

describe("toastStore", () => {
  it("cada variante tiene su duración por defecto", () => {
    toast.success("a");
    toast.info("b");
    toast.warning("c");
    toast.error("d");
    expect(useToastStore.getState().toasts.map((t) => t.duration)).toEqual([4000, 4000, 5000, 6000]);
  });

  it("duración y descripción se pueden indicar; duración 0 = no se cierra sola", () => {
    toast.error("x", { description: "detalle", duration: 0 });
    const t = useToastStore.getState().toasts[0];
    expect(t).toMatchObject({ variant: "error", message: "x", description: "detalle", duration: 0 });
  });

  it("los ids son distintos y crecientes", () => {
    const a = toast.info("a");
    const b = toast.info("b");
    expect(b).toBeGreaterThan(a);
  });

  it("dismiss quita solo ese aviso; clear los quita todos", () => {
    const a = toast.info("a");
    toast.info("b");
    toast.dismiss(a);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["b"]);
    toast.clear();
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
