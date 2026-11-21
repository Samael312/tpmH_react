// Fase 24 (C5): la consulta de huecos manda el día LOCAL con su zona (antes el backend lo leía como día UTC).
// Estas sondas son de comportamiento YA CORREGIDO (test_fixed_*): fallan si se vuelve a pedir `date` sin zona.
// Ejecutar: cd frontend && npx vitest run --config __tz_probes__/vitest.config.ts
import { describe, expect, it } from "vitest";
import { buildSlotsUrl } from "@/hooks/useStudentData";

describe("C5 · /slots recibe date + tz", () => {
  it("test_fixed_slots_url_sends_local_day_with_zone", () => {
    const u = buildSlotsUrl("profe", "2026-11-30", 50, "regular", "Europe/Madrid");
    expect(u).toBe("/availability/profe/slots?date=2026-11-30&duration=50&class_type=regular&tz=Europe%2FMadrid");
  });
  it("test_fixed_slots_url_keeps_bypass_flag_for_staff", () => {
    const u = buildSlotsUrl("profe", "2026-11-30", 50, "regular", "America/Bogota", true);
    expect(u).toContain("tz=America%2FBogota");
    expect(u.endsWith("&bypass_min_notice=true")).toBe(true);
  });
  it("control: la zona distingue la ventana (misma fecha, distinta URL => distinta clave de caché del backend)", () => {
    expect(buildSlotsUrl("p", "2026-11-30", 50, "regular", "Asia/Tokyo"))
      .not.toBe(buildSlotsUrl("p", "2026-11-30", 50, "regular", "America/Bogota"));
  });
});
