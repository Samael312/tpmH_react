/**
 * Perfil público de un profesor (componente compartido por la vista del alumno, la pública y la vista previa del
 * profesor): datos básicos, redes con el enlace correcto, secciones opcionales y reseñas.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { screen } from "@testing-library/react";
import PublicProfileView, { displayTeacherName, type PublicProfileTeacher, type PublicProfileReview } from "@/components/teacher/PublicProfileView";
import { renderScreen } from "./render";

const T = (over: Partial<PublicProfileTeacher> = {}): PublicProfileTeacher => ({
  user_username: "maria_f", name: "María", surname: "Farías", title: "Profesora de español", bio: "Hola, soy María.", status: "approved",
  languages: ["Español", "Inglés", "Francés", "Italiano"], subjects: ["Gramática"], skills: ["Conversación"], certificates: [{ title: "DELE C2", year: "2020" }],
  nationality: "Chile", social_links: {}, ...over,
});
const R = (id: number, rating: number, over: Partial<PublicProfileReview> = {}): PublicProfileReview => ({
  id, student_name: `Alumno${id}`, rating, comment: `Comentario ${id}`, created_at: "2026-02-10T12:00:00Z", total_completed_classes: 3, ...over,
});

const view = (teacher: PublicProfileTeacher, reviews: PublicProfileReview[] = [], extra: Partial<React.ComponentProps<typeof PublicProfileView>> = {}) =>
  renderScreen(<PublicProfileView teacher={teacher} reviews={reviews} {...extra} />);

describe("displayTeacherName", () => {
  it("usa nombre y apellido; si faltan, el usuario sin guiones; y si no hay nada, «Profesor»", () => {
    expect(displayTeacherName(T())).toBe("María Farías");
    expect(displayTeacherName(T({ name: null, surname: null }))).toBe("maria f");
    expect(displayTeacherName(T({ name: "", surname: "", user_username: "" }))).toBe("Profesor");
  });
});

describe("PublicProfileView · datos", () => {
  it("muestra nombre, título, nacionalidad, idiomas (máximo 3) y verificación", () => {
    view(T());
    expect(screen.getAllByText("María Farías").length).toBeGreaterThan(0);
    expect(screen.getByText("Profesora de español")).toBeInTheDocument();
    expect(screen.getByText(/Chile/)).toBeInTheDocument();
    expect(screen.getByText("Perfil Verificado")).toBeInTheDocument();
    expect(screen.getByText("Español")).toBeInTheDocument();
    expect(screen.queryByText("Italiano")).not.toBeInTheDocument();
  });

  it("un perfil no aprobado lo dice", () => {
    view(T({ status: "pending" }));
    expect(screen.getByText("Pendiente de Aprobación")).toBeInTheDocument();
  });

  it("secciones: sobre mí, materias, habilidades y certificaciones", () => {
    view(T());
    expect(screen.getByText("Hola, soy María.")).toBeInTheDocument();
    expect(screen.getByText("Qué enseña")).toBeInTheDocument();
    expect(screen.getByText("Gramática")).toBeInTheDocument();
    expect(screen.getByText("Habilidades")).toBeInTheDocument();
    expect(screen.getByText("Conversación")).toBeInTheDocument();
    expect(screen.getByText("Certificaciones")).toBeInTheDocument();
    expect(screen.getByText("DELE C2")).toBeInTheDocument();
    expect(screen.getByText("2020")).toBeInTheDocument();
  });

  it("sin datos opcionales se omiten las secciones y la biografía tiene texto por defecto", () => {
    view(T({ bio: null, subjects: [], skills: null, certificates: [], title: null, nationality: null, languages: null }));
    expect(screen.getByText("Sin descripción disponible por el momento.")).toBeInTheDocument();
    expect(screen.queryByText("Qué enseña")).not.toBeInTheDocument();
    expect(screen.queryByText("Habilidades")).not.toBeInTheDocument();
    expect(screen.queryByText("Certificaciones")).not.toBeInTheDocument();
  });

  it("con foto la usa; con video muestra el reproductor", () => {
    const { container } = view(T({ profile_photo_url: "https://img/p.png", video_url: "https://v/x.mp4" }));
    expect(container.querySelector("img")).toBeTruthy();
    expect(container.querySelector("video")).toHaveAttribute("src", "https://v/x.mp4");
    expect(screen.getByText("Video de presentación")).toBeInTheDocument();
  });

  it("sin video no hay sección de video", () => {
    view(T());
    expect(screen.queryByText("Video de presentación")).not.toBeInTheDocument();
  });

  it("acciones del banner: izquierda, derecha y héroe", () => {
    view(T(), [], { topLeftAction: <button>Volver X</button>, topRightAction: <button>Refrescar X</button>, heroActions: <button>Acción X</button>, reviewForm: <p>Formulario X</p> });
    expect(screen.getByText("Volver X")).toBeInTheDocument();
    expect(screen.getByText("Refrescar X")).toBeInTheDocument();
    expect(screen.getByText("Acción X")).toBeInTheDocument();
    expect(screen.getByText("Formulario X")).toBeInTheDocument();
  });
});

describe("PublicProfileView · redes sociales", () => {
  const hrefOf = (title: string) => (screen.getByTitle(title) as HTMLAnchorElement).getAttribute("href");

  it("arma el enlace correcto de cada red", () => {
    view(T({ social_links: { instagram: "@maria", tiktok: "@mari", whatsapp: "+58 412-555", youtube: "youtube.com/c/x", linkedin: "https://linkedin.com/in/x", website: "maria.com" } }));
    expect(hrefOf("Instagram")).toBe("https://instagram.com/maria");
    expect(hrefOf("TikTok")).toBe("https://tiktok.com/@mari");
    expect(hrefOf("WhatsApp")).toBe("https://wa.me/58412555");
    expect(hrefOf("YouTube")).toBe("https://youtube.com/c/x");
    expect(hrefOf("LinkedIn")).toBe("https://linkedin.com/in/x");
    expect(hrefOf("Sitio web")).toBe("https://maria.com");
    document.querySelectorAll('a[target="_blank"]').forEach((a) => expect(a.getAttribute("rel")).toMatch(/noopener/));
  });

  it("respeta URLs completas de Instagram y TikTok", () => {
    view(T({ social_links: { instagram: "https://instagram.com/otra", tiktok: "https://tiktok.com/@otra" } }));
    expect(hrefOf("Instagram")).toBe("https://instagram.com/otra");
    expect(hrefOf("TikTok")).toBe("https://tiktok.com/@otra");
  });

  it("valores vacíos o sin dígitos no pintan el enlace", () => {
    view(T({ social_links: { instagram: "@", whatsapp: "abc", tiktok: "@", youtube: "" } }));
    expect(screen.queryByTitle("Instagram")).not.toBeInTheDocument();
    expect(screen.queryByTitle("WhatsApp")).not.toBeInTheDocument();
    expect(screen.queryByTitle("TikTok")).not.toBeInTheDocument();
    expect(screen.queryByTitle("YouTube")).not.toBeInTheDocument();
  });

  it("showWhatsapp=false oculta solo el WhatsApp", () => {
    view(T({ social_links: { whatsapp: "+58 412 555", instagram: "@maria" } }), [], { showWhatsapp: false });
    expect(screen.queryByTitle("WhatsApp")).not.toBeInTheDocument();
    expect(screen.getByTitle("Instagram")).toBeInTheDocument();
  });
});

describe("PublicProfileView · reseñas", () => {
  it("sin reseñas lo dice y la nota es 0,0", () => {
    view(T(), []);
    expect(screen.getByText("Aún no hay reseñas.")).toBeInTheDocument();
    expect(screen.getByText("0.0")).toBeInTheDocument();
    expect(screen.getByText(/Reseñas de estudiantes \(0\)/)).toBeInTheDocument();
  });

  it("calcula el promedio y muestra cada reseña con su fecha y clases completadas (singular y plural)", () => {
    view(T(), [R(1, 5, { total_completed_classes: 1 }), R(2, 4), R(3, 3, { total_completed_classes: null, student_name: "", created_at: "" })]);
    expect(screen.getAllByText("4.0").length).toBeGreaterThan(0);
    expect(screen.getByText(/Reseñas de estudiantes \(3\)/)).toBeInTheDocument();
    expect(screen.getByText(/Comentario 1/)).toBeInTheDocument();
    expect(screen.getByText(/1 clase completada con este profesor/)).toBeInTheDocument();
    expect(screen.getByText(/3 clases completadas con este profesor/)).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("si las reseñas no son una lista no rompe", () => {
    view(T(), null as unknown as PublicProfileReview[]);
    expect(screen.getByText("Aún no hay reseñas.")).toBeInTheDocument();
  });
});
