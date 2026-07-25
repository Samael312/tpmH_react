import { useState, useEffect, useCallback } from "react";
import api from "@/lib/api";

export interface LandingTeacher {
  user_username: string;
  name?: string;          // puede no venir del backend, hay fallback
  bio: string | null;
  title: string | null;
  photo_url?: string | null;
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

const FALLBACK_USERNAME =
  process.env.NEXT_PUBLIC_FEATURED_TEACHER_USERNAME ?? "mar12";

function displayName(t: any): string {
  return t?.name || t?.user_username?.replace(/[_.]/g, " ") || "Profesor";
}

export function useLandingData() {
  const [loading, setLoading] = useState(true);
  const [isSingleTenant, setIsSingleTenant] = useState(true);
  const [teachers, setTeachers] = useState<LandingTeacher[]>([]);
  const [reviews, setReviews] = useState<LandingReview[]>([]);
  const [platformName, setPlatformName] = useState("TuProfeMaria");
  const [platformTagline, setPlatformTagline] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfgRes = await api.get("/admin/platform-config");
      const cfg: PlatformConfigResp = cfgRes.data;
      setPlatformName(cfg.platform_name || "TuProfeMaria");
      setPlatformTagline(cfg.platform_tagline ?? null);
      setIsSingleTenant(cfg.is_single_tenant);

      if (cfg.is_single_tenant) {
        // ── Modo single-tenant: solo la profesora destacada ──
        const username = cfg.featured_teacher?.username || FALLBACK_USERNAME;

        const [tRes, rRes] = await Promise.all([
          api.get(`/teachers/${username}`),
          api.get(`/reviews/${username}`).catch(() => ({ data: [] })),
        ]);

        setTeachers([tRes.data]);
        setReviews(rRes.data);
      } else {
        // ── Modo multi-tenant: combinar hasta 5 profesores aprobados ──
        const listRes = await api.get("/teachers/");
        const list: LandingTeacher[] = (listRes.data || []).slice(0, 5);
        setTeachers(list);

        if (list.length > 0) {
          const reviewArrays = await Promise.all(
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
          );
          const merged = reviewArrays
            .flat()
            .sort(
              (a: any, b: any) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime()
            );
          setReviews(merged);
        } else {
          setReviews([]);
        }
      }
    } catch (e) {
      console.error("Error cargando datos de landing:", e);
      setTeachers([]);
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return {
    loading,
    isSingleTenant,
    teachers,
    reviews,
    platformName,
    platformTagline,
    refetch: load,
  };
}

export { displayName };