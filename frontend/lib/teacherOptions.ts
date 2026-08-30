// Opciones compartidas de perfil de profesor.
// Fuente única de verdad — se usa en onboarding, edición de perfil y
// creación de paquetes, para no duplicar estas listas en cada archivo.

export const SUBJECTS = [
  "Matematica", "Lenguaje", "Física", "Musica", "Quimica", "Historia",
  "Arte", "Programación", "Ciencias", "Economía", "Psicología", "Negocios",
];

export const LANGUAGES = [
  "Español", "Ingles", "Frances", "Italiano", "Portugues", "Aleman",
];

export const SKILL_SUGGESTIONS = [
  "Gramática", "Conversación", "Pronunciación", "Vocabulario",
  "Business English", "IELTS", "TOEFL", "Niños", "Viajes", "Redacción",
];

// Categorías de objetivo de aprendizaje. La plataforma no es solo de
// idiomas (hay Matemática, Física, Música, Programación, etc.), así que
// las sugerencias de "goal" se agrupan por categoría y el estudiante
// elige cuál se ajusta a lo que busca antes de ver las tarjetas.
export const GOAL_CATEGORIES = [
  { key: "idiomas", label: "Idiomas", icon: "🌐" },
  { key: "academico", label: "Otras materias", icon: "📘" },
] as const;

export type GoalCategoryKey = typeof GOAL_CATEGORIES[number]["key"];

export const GOALS: Record<GoalCategoryKey, { text: string; desc: string; icon: string }[]> = {
  idiomas: [
    { text: "Conversaciones cotidianas", desc: "Hablar de temas del día a día", icon: "🗣️" },
    { text: "Mejorar pronunciación", desc: "Fluidez y acento natural", icon: "🎙️" },
    { text: "Ampliar vocabulario", desc: "Palabras para situaciones reales", icon: "📚" },
    { text: "Comprender audios/videos", desc: "Entender a hablantes nativos", icon: "🎧" },
    { text: "Preparar exámenes", desc: "TOEFL, IELTS, Cambridge, etc.", icon: "📝" },
    { text: "Viajar al extranjero", desc: "Comunicarme sin problemas en otro país", icon: "✈️" },
  ],
  academico: [
    { text: "Reforzar lo que veo en clase", desc: "Entender mejor los temas de mi curso", icon: "📘" },
    { text: "Ponerme al día", desc: "Recuperar contenido atrasado", icon: "⏱️" },
    { text: "Preparar un examen", desc: "Estudiar para una evaluación o admisión", icon: "📝" },
    { text: "Resolver dudas puntuales", desc: "Ayuda con tareas o ejercicios específicos", icon: "❓" },
    { text: "Aprender desde cero", desc: "Empezar sin conocimientos previos", icon: "🌱" },
    { text: "Prepararme para una competencia", desc: "Olimpiadas, concursos u otros retos", icon: "🏆" },
  ],
};

/**
 * Acepta tanto el formato nuevo (dict agrupado por categoría) como el
 * formato viejo (lista plana, legado del catálogo pre-migración) y
 * siempre devuelve un dict agrupado. Así el frontend no rompe si el
 * catálogo en BD todavía no fue migrado o el admin guardó una lista.
 */
export function normalizeGoalsCatalog(
  raw: unknown
): Record<string, { text: string; desc: string; icon: string }[]> {
  if (Array.isArray(raw) && raw.length) {
    return { idiomas: raw as { text: string; desc: string; icon: string }[] };
  }
  if (raw && typeof raw === "object" && Object.keys(raw).length) {
    return raw as Record<string, { text: string; desc: string; icon: string }[]>;
  }
  return GOALS;
}

/** Aplana todas las categorías en una sola lista (para detectar objetivos personalizados). */
export function flattenGoals(
  grouped: Record<string, { text: string; desc: string; icon: string }[]>
): { text: string; desc: string; icon: string }[] {
  return Object.values(grouped).flat();
}

export const PAYMENT_METHODS =  [
  { value: "Paypal",       label: "PayPal",             icon: "💳", color: "text-blue-600" },
  { value: "Binance",      label: "Binance (USDT)",     icon: "🔶", color: "text-yellow-500" },
  { value: "Zelle",        label: "Zelle",              icon: "💜", color: "text-purple-600" },
  { value: "BankTransfer", label: "Transferencia bancaria", icon: "🏦", color: "text-emerald-600" },
  { value: "MobilePayment", label: "Pago móvil/Bizum",  icon: "📱", color: "text-pink-600" },
];

export const TOPICS = [
  'Grammar','Reading','Exercises','Vocabulary'
];

export const LEVELS = ['A1','A2','B1','B2','C1','C2'];