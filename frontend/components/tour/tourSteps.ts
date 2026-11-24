export interface TourStep {
  id: string;
  /** Selector del elemento a resaltar; null = tarjeta centrada (bienvenida y cierre). */
  target: string | null;
  title: string;
  body: string;
  /** En móvil el ítem vive en el panel «Más»: la guía lo abre para resaltarlo. */
  more?: boolean;
}

export const navTarget = (href: string) => `[data-tour="nav-${href}"]`;

const WELCOME = (who: string): TourStep => ({
  id: "welcome", target: null, title: "¡Te damos la bienvenida!",
  body: `Te mostramos en un minuto dónde está cada cosa. ${who}`,
});
const END: TourStep = {
  id: "end", target: null, title: "¡Listo!",
  body: "Ya conoces el menú. Puedes repetir esta guía desde tu perfil cuando quieras.",
};

const s = (id: string, href: string, title: string, body: string, more = false): TourStep =>
  ({ id, target: navTarget(href), title, body, ...(more ? { more: true } : {}) });

export const STUDENT_STEPS: TourStep[] = [
  WELCOME("Puedes saltar la guía cuando quieras."),
  s("home", "/dashboard", "Inicio", "Tu resumen: próximas clases, créditos y avisos importantes."),
  s("schedule", "/dashboard/schedule", "Horario", "Mira tus clases por día y reserva nuevas con tu profesor."),
  s("classes", "/dashboard/classes", "Clases", "Tu historial y tus próximas clases, con el enlace para entrar."),
  s("profile", "/dashboard/profile", "Perfil", "Tus datos, tu foto, tus idiomas y tus preferencias."),
  s("chat", "/dashboard/chat", "Chat", "Escribe a tu profesor y resuelve dudas entre clases.", true),
  s("availability", "/dashboard/availability", "Disponibilidad", "Indica cuándo puedes tener clases para que te propongan horarios.", true),
  s("materials", "/dashboard/materials", "Materiales", "Documentos y vocabulario que tu profesor te asigna; el vocabulario tiene audio.", true),
  s("homework", "/dashboard/homework", "Tareas", "Entrega tus tareas y revisa las notas y comentarios.", true),
  s("teachers", "/dashboard/teachers", "Profesor", "Tu profesor y sus paquetes de clases.", true),
  s("support", "/dashboard/support", "Soporte", "¿Algo no funciona? Abre un ticket y te ayudamos.", true),
  END,
];

export const TEACHER_STEPS: TourStep[] = [
  WELCOME("Puedes saltar la guía cuando quieras."),
  s("classes", "/teacher/dashboard", "Clases", "Tus clases de hoy y las próximas, con acceso rápido a cada una."),
  s("availability", "/teacher/availability", "Horario", "Define los días y horas en que das clases."),
  s("students", "/teacher/students", "Estudiantes", "Tus alumnos, su progreso y sus créditos."),
  s("profile", "/teacher/profile", "Perfil", "Tu presentación pública, tus idiomas y tus datos de cobro."),
  s("chat", "/teacher/chat", "Chat", "Habla con tus alumnos antes y después de las clases.", true),
  s("notifications", "/teacher/notifications", "Avisos", "Reservas, cancelaciones y pagos al instante.", true),
  s("materials", "/teacher/materials", "Materiales", "Sube documentos y crea vocabulario con audio para tus alumnos.", true),
  s("homework", "/teacher/homework", "Tareas", "Asigna tareas, recibe entregas y califícalas.", true),
  s("packages", "/teacher/packages", "Paquetes", "Crea los paquetes de clases que vendes.", true),
  s("cohorts", "/teacher/cohorts", "Grupos", "Organiza clases grupales con varios alumnos.", true),
  s("wallet", "/teacher/wallet", "Ganancias", "Tu saldo, tus cobros y tus retiros.", true),
  s("support", "/teacher/support", "Soporte", "¿Necesitas ayuda? Abre un ticket.", true),
  END,
];

export function stepsForRole(role?: string): TourStep[] {
  if (role === "student") return STUDENT_STEPS;
  if (role === "teacher" || role === "teacher_admin") return TEACHER_STEPS;
  return [];
}
