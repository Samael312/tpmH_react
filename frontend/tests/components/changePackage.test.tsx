/**
 * ChangePackageModal: elegir el paquete nuevo. Un "downgrade" sin créditos usados abre primero la elección
 * reembolso completo / ajuste por diferencia; en cualquier otro caso va directo al pago.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import ChangePackageModal from "@/components/payments/ChangePackageModal";
import { renderScreen } from "./render";
import { mockApi, mockApiError, FIXTURE } from "./fakeApi";

const pkg = (id: number, name: string, classes: number | null, price: number, over: Record<string, unknown> = {}) => ({
  id, name, classes_count: classes, price, duration_minutes: 50, class_type: "individual", is_active: true, is_group: false, teacher_id: 7, ...over,
});

// Paquete actual = id 3 (Pack 8: 8 clases, $120).
const CATALOG = [
  pkg(3, "Pack 8", 8, 120),
  pkg(4, "Pack 12", 12, 170),
  pkg(5, "Pack 4", 4, 70),
  pkg(6, "Grupal", 10, 90, { is_group: true }),
  pkg(7, "Ilimitado", null, 300),
];

function setup(enrollmentOver: Record<string, unknown> = {}) {
  mockApi("get", "/packages/teacher/profe", CATALOG);
  const onClose = vi.fn(); const onDone = vi.fn();
  const enrollment = { ...FIXTURE.enrollment, id: 11, classes_total: 8, available_credits: 8, package: { ...FIXTURE.package, id: 3, classes_count: 8, price: 120 }, ...enrollmentOver };
  renderScreen(<ChangePackageModal enrollment={enrollment as never} teacherUsername="profe" onClose={onClose} onDone={onDone} />, { role: "student" });
  return { onClose, onDone, user: userEvent.setup() };
}

describe("ChangePackageModal · catálogo", () => {
  it("lista los otros paquetes del profesor: excluye el actual y los grupales", async () => {
    setup();
    expect(await screen.findByText("Pack 12")).toBeInTheDocument();
    expect(screen.getByText("Pack 4")).toBeInTheDocument();
    expect(screen.getByText("Ilimitado")).toBeInTheDocument();
    expect(screen.queryByText("Pack 8")).not.toBeInTheDocument();
    expect(screen.queryByText("Grupal")).not.toBeInTheDocument();
  });

  it("ilimitado se rotula «Ilimitadas»; el resto, con su número de clases y precio", async () => {
    setup();
    expect(await screen.findByText(/Ilimitadas · \$300/)).toBeInTheDocument();
    expect(screen.getByText(/12 clases · \$170/)).toBeInTheDocument();
  });

  it("sin otros paquetes lo dice", async () => {
    mockApi("get", "/packages/teacher/profe", [pkg(3, "Pack 8", 8, 120)]);
    renderScreen(<ChangePackageModal enrollment={{ ...FIXTURE.enrollment, package: { ...FIXTURE.package, id: 3 } } as never} teacherUsername="profe" onClose={() => {}} onDone={() => {}} />, { role: "student" });
    expect(await screen.findByText(/No hay otros paquetes disponibles/)).toBeInTheDocument();
  });

  it("si el catálogo no carga lo dice y no ofrece nada", async () => {
    mockApiError("get", "/packages/teacher/profe", 500, "x");
    renderScreen(<ChangePackageModal enrollment={FIXTURE.enrollment as never} teacherUsername="profe" onClose={() => {}} onDone={() => {}} />, { role: "student" });
    expect(await screen.findByText(/No se pudieron cargar los paquetes/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Solicitar" })).not.toBeInTheDocument();
  });

  it("la X cierra", async () => {
    const { user, onClose } = setup();
    await screen.findByText("Pack 12");
    await user.click(screen.getAllByRole("button").find((b) => !b.textContent?.trim())!);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ChangePackageModal · rutas de cambio", () => {
  const solicit = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    const row = (await screen.findByText(name)).closest("div.flex") as HTMLElement;
    await user.click(row.querySelector("button") as HTMLElement);
  };

  it("upgrade (más clases) va directo al pago, sin preguntar por reembolso", async () => {
    const { user } = setup();
    await solicit(user, "Pack 12");
    expect(await screen.findByText("Completar pago")).toBeInTheDocument();
    expect(screen.queryByText(/Todavía no usaste créditos/)).not.toBeInTheDocument();
  });

  it("downgrade SIN créditos usados pregunta primero: reembolso completo o ajuste por diferencia", async () => {
    const { user } = setup();
    await solicit(user, "Pack 4");
    expect(await screen.findByText(/Todavía no usaste créditos de tu paquete actual/)).toBeInTheDocument();
    expect(screen.getByText("Reembolso completo")).toBeInTheDocument();
    expect(screen.getByText("Ajustar por diferencia")).toBeInTheDocument();
    expect(screen.getByText(/\$120/)).toBeInTheDocument();
  });

  it("elegir reembolso completo lleva a «Confirmar reembolso»", async () => {
    const { user } = setup();
    await solicit(user, "Pack 4");
    await user.click(await screen.findByText("Reembolso completo"));
    expect(await screen.findByText("Confirmar reembolso")).toBeInTheDocument();
  });

  it("elegir ajuste por diferencia lleva a «Completar pago»", async () => {
    const { user } = setup();
    await solicit(user, "Pack 4");
    await user.click(await screen.findByText("Ajustar por diferencia"));
    expect(await screen.findByText("Completar pago")).toBeInTheDocument();
  });

  it("«Volver» en la pregunta regresa al catálogo", async () => {
    const { user } = setup();
    await solicit(user, "Pack 4");
    await user.click(await screen.findByRole("button", { name: "Volver" }));
    expect(await screen.findByText("Cambiar de paquete")).toBeInTheDocument();
  });

  it("downgrade CON créditos usados va directo al pago (no hay reembolso completo posible)", async () => {
    const { user } = setup({ available_credits: 5 }); // usó 3 de 8
    await solicit(user, "Pack 4");
    expect(await screen.findByText("Completar pago")).toBeInTheDocument();
    expect(screen.queryByText(/Todavía no usaste créditos/)).not.toBeInTheDocument();
  });

  it("pasar a ilimitado nunca se trata como downgrade", async () => {
    const { user } = setup();
    await solicit(user, "Ilimitado");
    expect(await screen.findByText("Completar pago")).toBeInTheDocument();
  });
});
