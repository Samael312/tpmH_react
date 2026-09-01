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

interface LandingData {
  isSingleTenant: boolean;
  teachers: LandingTeacher[];
  reviews: LandingReview[];
  packages: LandingPackage[];
  platformName: string;
  platformTagline: string | null;
}

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
    staleTime: 5 * 60 * 1000, // 5 min: contenido público, no urge revalidar en cada visita
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
    refetch,
  };
}

export { displayName };
export type { LandingData };
