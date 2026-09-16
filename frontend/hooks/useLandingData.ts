import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { displayName } from "@/lib/displayName";

export interface LandingTeacher {
  user_username: string;
  name?: string;
  surname?: string;
  bio: string | null;
  title: string | null;
  profile_photo_url?: string | null;
  video_url?: string | null;
  nationality?: string | null;
  languages: string[];
  subjects: string[];
  skills: string[];
  certificates: { title: string; year: string }[];
  social_links: Record<string, string>;
}

export interface LandingReview {
  id: number;
  student_name: string;
  rating: number;
  comment: string;
  created_at: string;
  teacher_username?: string;
}

export interface LandingPackage {
  id: number;
  name: string;
  subject: string;
  description: string | null;
  description_type: string;
  description_items: string[] | null;
  icon: string;
  color: string;
  classes_count: number | null;
  price: number;
  duration_minutes: number;
  teacher_username: string;
  teacher_name: string;
  teacher_avatar: string | null;
  is_group: boolean;
  min_students: number | null;
  max_students: number | null;
}

export interface LandingGroupStep {
  title: string;
  desc: string;
}

/**
 * Mapa campo de título → id de gradiente predefinido (ver
 * lib/gradientTitle.tsx). Clave = nombre del campo en LandingContent
 * (ej. "hero_title_single"), valor = uno de GRADIENT_PRESETS.id. Un campo
 * ausente de este mapa (o con valor vacío) se muestra sin gradiente. Las
 * palabras que llevan el color se marcan directamente en el texto del
 * campo con `{{palabra}}`.
 */
export type TitleGradientMap = Partial<Record<string, string>>;

export interface LandingContent {
  hero_title_single: string;
  hero_title_multi: string;
  about_label_single: string;
  about_label_multi: string;
  about_title_single: string;
  about_title_multi: string;
  about_description_single: string;
  about_description_multi: string;
  videos_title_single: string;
  videos_title_multi: string;
  videos_subtitle: string;
  plans_label: string;
  plans_title: string;
  plans_subtitle: string;
  group_plans_title: string;
  group_plans_subtitle_single: string;
  group_plans_subtitle_multi: string;
  group_steps: LandingGroupStep[];
  reviews_title_single: string;
  reviews_title_multi: string;
  reviews_subtitle: string;
  cta_title: string;
  cta_subtitle: string;
  footer_tagline: string;
  title_gradients: TitleGradientMap;
}

interface LandingData {
  isSingleTenant: boolean;
  teachers: LandingTeacher[];
  reviews: LandingReview[];
  packages: LandingPackage[];
  platformName: string;
  platformTagline: string | null;
  landingContent: LandingContent;
}

// Espejo de LANDING_CONTENT_DEFAULTS en backend/app/core/platform_config.py —
// se usa como fallback antes de que cargue el fetch, o si falla del todo.
// El backend siempre manda el objeto completo (mergeado con lo que haya
// guardado el admin), así que en la práctica esto solo se ve un instante.
export const LANDING_CONTENT_DEFAULTS: LandingContent = {
  hero_title_single: "Aprende idiomas a tu ritmo",
  hero_title_multi: "El conocimiento que buscas, como tú lo prefieres",
  about_label_single: "Sobre mí",
  about_label_multi: "Nuestro equipo",
  about_title_single: "Conoceme un poco mejor",
  about_title_multi: "Conoce a nuestros profesores",
  about_description_single:
    "Una apasionada del idioma con años de experiencia enseñando a estudiantes de todos los niveles y países.",
  about_description_multi:
    "Un equipo de profesores certificados, cada uno con su propia especialidad, listos para acompañarte.",
  videos_title_single: "Escucha a tu profesora",
  videos_title_multi: "Escucha a nuestros profesores",
  videos_subtitle: "Antes de reservar tu clase, mira quién estará al otro lado de la pantalla.",
  plans_label: "Planes y precios",
  plans_title: "Elige tu plan",
  plans_subtitle: "Sin contratos. Sin letra pequeña. Solo aprendizaje.",
  group_plans_title: "Aprende en grupo, paga menos",
  group_plans_subtitle_single:
    "Comparte la clase con otros estudiantes de tu nivel y ahorra frente al plan individual.",
  group_plans_subtitle_multi:
    "Varios de nuestros profesores arman grupos reducidos por nivel e idioma. Comparten la clase, comparten el precio.",
  group_steps: [
    { title: "Te inscribes", desc: "Eliges un paquete grupal y reservas tu cupo. Cada grupo tiene un mínimo y un máximo de alumnos." },
    { title: "Se completa el grupo", desc: "Cuando se alcanza el mínimo de estudiantes, el horario del grupo queda confirmado para todos." },
    { title: "Empiezan las clases", desc: "Si el grupo no se llega a completar, siempre puedes pasar tu cupo a clases individuales." },
  ],
  reviews_title_single: "Lo que dicen mis alumnos",
  reviews_title_multi: "Historias de Éxito",
  reviews_subtitle: "Personas reales, resultados reales.",
  cta_title: "¿Listo para empezar?",
  cta_subtitle: "Tu primera clase de prueba es gratuita. Sin compromisos, sin tarjeta de crédito.",
  footer_tagline: "Empoderando estudiantes",
  title_gradients: {},
};

async function fetchLandingData(): Promise<LandingData> {
  try {
    const res = await api.get("/public/landing");
    const data = res.data;

    return {
      isSingleTenant: data.is_single_tenant,
      platformName: data.platform_name || "TuProfeMaria",
      platformTagline: data.platform_tagline ?? null,
      teachers: data.teachers ?? [],
      reviews: data.reviews ?? [],
      packages: data.packages ?? [],
      landingContent: { ...LANDING_CONTENT_DEFAULTS, ...(data.landing_content ?? {}) },
    };
  } catch (err) {
    // Antes esto se perdía en un .catch(() => []) silencioso por cada
    // sub-request; ahora es un solo fetch, pero si falla igual queremos
    // verlo en la consola (y, si el proyecto suma Sentry u otro APM más
    // adelante, acá es donde se reportaría) en vez de que la landing
    // se quede muda mostrando secciones vacías sin explicación.
    console.error("[landing] fallo al traer /public/landing:", err);
    throw err;
  }
}

/**
 * `initialData`, cuando viene provisto, es la respuesta que ya trajo el
 * Server Component (`app/page.tsx` vía `getLandingDataServer`) en el
 * primer render. Sembrar el cache de react-query con ella evita el
 * parpadeo de skeleton en la carga inicial y, más importante, hace que
 * el HTML que devuelve el servidor ya tenga el contenido real — no un
 * shell vacío que solo se llena tras hidratar en el cliente.
 */
export function useLandingData(initialData?: LandingData | null) {
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["landing-data"],
    queryFn: fetchLandingData,
    staleTime: 60 * 1000, // 60s: igual al TTL del cache en memoria del backend (ver public.py)
    // Siempre revalida al montar, aunque el query-cache de react-query ya
    // tenga una entrada "fresca": ese cache vive en memoria del browser y
    // sobrevive a la navegación entre páginas, así que si un admin cambia
    // single-tenant <-> multi-tenant y vuelve a "/", el SSR trae initialData
    // nuevo pero react-query lo ignora (initialData solo se usa cuando no
    // hay entrada previa para la queryKey) y seguía mostrando la config
    // vieja hasta que venciera el staleTime. Con "always" el usuario ve
    // initialData al instante y, en paralelo, se confirma/corrige contra
    // el backend en vez de quedar pegado al estado anterior.
    refetchOnMount: "always",
    ...(initialData ? { initialData } : {}),
  });

  return {
    loading: isLoading,
    isFetching,
    // Solo interesa como "falló de verdad" cuando no hay ningún dato para
    // mostrar (ni siquiera initialData de SSR) — si ya hay data previa,
    // un refetch en background que falla no debería tirar abajo la página.
    isError: isError && !data,
    error,
    isSingleTenant: data?.isSingleTenant ?? true,
    teachers: data?.teachers ?? [],
    reviews: data?.reviews ?? [],
    packages: data?.packages ?? [],
    platformName: data?.platformName ?? "TuProfeMaria",
    platformTagline: data?.platformTagline ?? null,
    landingContent: data?.landingContent ?? LANDING_CONTENT_DEFAULTS,
    refetch,
  };
}

export { displayName };
export type { LandingData };
