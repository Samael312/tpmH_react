import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

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
}

interface PlatformConfigResp {
  platform_name: string;
  platform_tagline: string | null;
  is_single_tenant: boolean;
  featured_teacher: {
    username: string;
    name: string;
    title: string | null;
    bio: string | null;
    avatar: string | null;
    subjects: string[];
  } | null;
}

interface LandingData {
  isSingleTenant: boolean;
  teachers: LandingTeacher[];
  reviews: LandingReview[];
  packages: LandingPackage[];
  platformName: string;
  platformTagline: string | null;
}

const FALLBACK_USERNAME =
  process.env.NEXT_PUBLIC_FEATURED_TEACHER_USERNAME ?? "mar12";

function displayName(t: any): string {
  const full = `${t?.name ?? ""} ${t?.surname ?? ""}`.trim();
  return full || t?.user_username?.replace(/[_.]/g, " ") || "Profesor";
}

async function fetchLandingData(): Promise<LandingData> {
  const cfgRes = await api.get("/admin/platform-config");
  const cfg: PlatformConfigResp = cfgRes.data;
  const platformName = cfg.platform_name || "TuProfeMaria";
  const platformTagline = cfg.platform_tagline ?? null;
  const isSingleTenant = cfg.is_single_tenant;

  if (isSingleTenant) {
    // ── Modo single-tenant: solo la profesora destacada ──
    const username = cfg.featured_teacher?.username || FALLBACK_USERNAME;

    const [tRes, rRes, pRes] = await Promise.all([
      api.get(`/teachers/${username}`),
      api.get(`/reviews/${username}`).catch(() => ({ data: [] })),
      api.get(`/packages/teacher/${username}`).catch(() => ({ data: [] })),
    ]);

    const teacherName = displayName(tRes.data);
    const teacherAvatar = tRes.data.profile_photo_url ?? null;

    return {
      isSingleTenant,
      platformName,
      platformTagline,
      teachers: [tRes.data],
      reviews: rRes.data,
      packages: (pRes.data || []).map((p: any) => ({
        ...p,
        teacher_username: username,
        teacher_name: teacherName,
        teacher_avatar: teacherAvatar,
      })),
    };
  }

  // ── Modo multi-tenant: combinar hasta 5 profesores aprobados ──
  const listRes = await api.get("/teachers/");
  const list: LandingTeacher[] = (listRes.data || []).slice(0, 5);

  if (list.length === 0) {
    return {
      isSingleTenant,
      platformName,
      platformTagline,
      teachers: [],
      reviews: [],
      packages: [],
    };
  }

  const [reviewArrays, packageArrays] = await Promise.all([
    Promise.all(
      list.map((t) =>
        api
          .get(`/reviews/${t.user_username}`)
          .then((r) =>
            (r.data || []).map((rev: any) => ({
              ...rev,
              teacher_username: t.user_username,
            }))
          )
          .catch(() => [])
      )
    ),
    Promise.all(
      list.map((t) =>
        api
          .get(`/packages/teacher/${t.user_username}`)
          .then((r) =>
            (r.data || []).map((p: any) => ({
              ...p,
              teacher_username: t.user_username,
              teacher_name: displayName(t),
              teacher_avatar: t.profile_photo_url ?? null,
            }))
          )
          .catch(() => [])
      )
    ),
  ]);

  const mergedReviews = reviewArrays
    .flat()
    .sort(
      (a: any, b: any) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  return {
    isSingleTenant,
    platformName,
    platformTagline,
    teachers: list,
    reviews: mergedReviews,
    packages: packageArrays.flat(),
  };
}

export function useLandingData() {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["landing-data"],
    queryFn: fetchLandingData,
    staleTime: 5 * 60 * 1000, // 5 min: contenido público, no urge revalidar en cada visita
  });

  return {
    loading: isLoading,
    isFetching,
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
