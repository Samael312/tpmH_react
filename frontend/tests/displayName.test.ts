import { describe, expect, it } from "vitest";
import { displayName } from "@/lib/displayName";
import { capitalizeWords } from "@/lib/textFormat";

describe("displayName", () => {
  it("nombre y apellido", () => {
    expect(displayName({ name: "Ana", surname: "Pérez" })).toBe("Ana Pérez");
  });
  it("solo nombre o solo apellido, sin espacios sobrantes", () => {
    expect(displayName({ name: "Ana", surname: null })).toBe("Ana");
    expect(displayName({ name: "", surname: "Pérez" })).toBe("Pérez");
  });
  it("sin nombre: usa el usuario con espacios en lugar de _ y .", () => {
    expect(displayName({ user_username: "ana_perez.m" })).toBe("ana perez m");
  });
  it("sin nada: «Profesor»", () => {
    expect(displayName(null)).toBe("Profesor");
    expect(displayName({})).toBe("Profesor");
  });
});

describe("capitalizeWords", () => {
  it("capitaliza cada palabra sin tocar el resto", () => {
    expect(capitalizeWords("maría josé")).toBe("María José");
    expect(capitalizeWords("mcDonald")).toBe("McDonald");
  });
  it("respeta lo ya escrito en mayúsculas y los espacios finales (mientras se escribe)", () => {
    expect(capitalizeWords("ANA ")).toBe("ANA ");
    expect(capitalizeWords("ana ")).toBe("Ana ");
  });
  it("cadena vacía", () => {
    expect(capitalizeWords("")).toBe("");
  });
});
