/**
 * Carruseles de la landing: genérico, paquetes y videos de presentación de profesores.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import Carousel from "@/components/landing/Carousel";
import PackagesCarousel from "@/components/landing/PackagesCarousel";
import TeacherVideosCarousel, { type VideoTeacher } from "@/components/landing/TeacherVideosCarousel";
import { priceLabelSuffix } from "@/lib/packageThemes";
import type { LandingPackage } from "@/hooks/useLandingData";

describe("Carousel", () => {
  it("expone la pista como lista accesible con su etiqueta", () => {
    render(<Carousel ariaLabel="Cosas"><div role="listitem">uno</div></Carousel>);
    expect(screen.getByRole("list", { name: "Cosas" })).toBeInTheDocument();
  });

  it("las flechas desplazan la pista: siguiente a la derecha, anterior a la izquierda, con tope de 420 px", async () => {
    render(<Carousel ariaLabel="x"><div>a</div></Carousel>);
    const track = screen.getByRole("list");
    const scrollBy = vi.fn();
    (track as HTMLElement).scrollBy = scrollBy as never;
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 1000 });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 420, behavior: "smooth" });
    await user.click(screen.getByRole("button", { name: "Anterior" }));
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -420, behavior: "smooth" });
  });

  it("en pantallas estrechas se desplaza el 85 % del ancho", async () => {
    render(<Carousel><div>a</div></Carousel>);
    const track = screen.getByRole("list");
    const scrollBy = vi.fn();
    (track as HTMLElement).scrollBy = scrollBy as never;
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 300 });
    await userEvent.setup().click(screen.getByRole("button", { name: "Siguiente" }));
    expect(scrollBy).toHaveBeenCalledWith({ left: 255, behavior: "smooth" });
  });
});

describe("PackagesCarousel", () => {
  const pkg = (id: number, over: Partial<LandingPackage> = {}): LandingPackage => ({
    id, name: `Pack ${id}`, subject: "Español", classes_count: 8, duration_minutes: 50, price: 120, color: "#ec4899", icon: "🎯",
    teacher_name: "Profe Uno", teacher_avatar: null, ...over,
  } as LandingPackage);

  it("sin paquetes no pinta nada", () => {
    const { container } = render(<PackagesCarousel packages={[]} showTeacher />);
    expect(container.firstChild).toBeNull();
  });

  it("muestra nombre, materia, cantidad y duración de clases y precio con dos decimales", () => {
    render(<PackagesCarousel packages={[pkg(1)]} showTeacher={false} />);
    expect(screen.getByText("Pack 1")).toBeInTheDocument();
    expect(screen.getByText("Español")).toBeInTheDocument();
    expect(screen.getByText(/8 clases · 50 min c\/u/)).toBeInTheDocument();
    expect(screen.getByText(/\$120\.00/)).toBeInTheDocument();
    expect(screen.getByText(priceLabelSuffix(8))).toBeInTheDocument();
  });

  it("un paquete ilimitado se rotula «Clases ilimitadas»", () => {
    render(<PackagesCarousel packages={[pkg(1, { classes_count: null })]} showTeacher={false} />);
    expect(screen.getByText(/Clases ilimitadas · 50 min c\/u/)).toBeInTheDocument();
    expect(screen.getByText(priceLabelSuffix(null))).toBeInTheDocument();
  });

  it("sin icono usa el emoji de caja", () => {
    render(<PackagesCarousel packages={[pkg(1, { icon: "" })]} showTeacher={false} />);
    expect(screen.getByText("📦")).toBeInTheDocument();
  });

  it("el profesor solo aparece si se pide; sin foto usa su inicial y con foto la imagen", () => {
    const { rerender } = render(<PackagesCarousel packages={[pkg(1)]} showTeacher={false} />);
    expect(screen.queryByText("Profe Uno")).not.toBeInTheDocument();
    rerender(<PackagesCarousel packages={[pkg(1)]} showTeacher />);
    expect(screen.getByText("Profe Uno")).toBeInTheDocument();
    expect(screen.getByText("P")).toBeInTheDocument();
    rerender(<PackagesCarousel packages={[pkg(1, { teacher_avatar: "https://img.example.com/a.png" })]} showTeacher />);
    expect(screen.getByAltText("Profe Uno")).toHaveAttribute("src", "https://img.example.com/a.png");
  });

  it("hasta 4 paquetes se muestran todos juntos, sin carrusel", () => {
    render(<PackagesCarousel packages={[1, 2, 3, 4].map((i) => pkg(i))} showTeacher={false} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4);
  });

  it("a partir de 5 paquetes pasa a carrusel con flechas", () => {
    render(<PackagesCarousel packages={[1, 2, 3, 4, 5].map((i) => pkg(i))} showTeacher={false} />);
    expect(screen.getByRole("list", { name: "Paquetes disponibles" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeInTheDocument();
  });
});

describe("TeacherVideosCarousel", () => {
  const t = (user_username: string, over: Partial<VideoTeacher> = {}): VideoTeacher => ({
    user_username, name: `Profe ${user_username}`, title: "Profesor de español", video_url: `https://cdn.example.com/${user_username}.mp4`, ...over,
  });

  it("sin profesores con video no pinta nada", () => {
    const { container } = render(<TeacherVideosCarousel teachers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("con uno solo lo destaca (sin flechas de carrusel) con su insignia", () => {
    render(<TeacherVideosCarousel teachers={[t("ana")]} />);
    expect(screen.getByText("Video de presentación")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Siguiente" })).not.toBeInTheDocument();
    expect(screen.getByText("Profe ana")).toBeInTheDocument();
  });

  it("con varios usa carrusel y muestra nombre y título de cada uno", () => {
    render(<TeacherVideosCarousel teachers={[t("ana"), t("luis", { title: null })]} />);
    expect(screen.getByRole("list", { name: "Videos de presentación de profesores" })).toBeInTheDocument();
    expect(screen.getByText("Profe luis")).toBeInTheDocument();
    expect(screen.getAllByText("Profesor de español")).toHaveLength(1); // luis no tiene título
  });

  it("pulsar una tarjeta abre el reproductor con su video; la X y el fondo lo cierran", async () => {
    const { container } = render(<TeacherVideosCarousel teachers={[t("ana"), t("luis")]} />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Profe luis").closest("button") as HTMLElement);
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.getAttribute("src")).toBe("https://cdn.example.com/luis.mp4");
    expect(video.controls).toBe(true);
    const close = container.querySelector(".fixed button") as HTMLElement;
    await user.click(close);
    expect(container.querySelector("video")).toBeNull();
  });

  it("clic en el fondo oscuro cierra, pero clic dentro del reproductor no", async () => {
    const { container } = render(<TeacherVideosCarousel teachers={[t("ana")]} />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Profe ana").closest("button") as HTMLElement);
    await user.click(container.querySelector("video") as HTMLElement);
    expect(container.querySelector("video")).not.toBeNull();
    await user.click(container.querySelector(".fixed") as HTMLElement);
    expect(container.querySelector("video")).toBeNull();
  });
});
