import { useState, useEffect, useCallback } from "react";
import api from "@/lib/api";

export interface StudentClass {
  id: number;
  class_type: "trial" | "regular";
  subject: string | null;
  start_time_utc: string;
  end_time_utc: string;
  duration_minutes: number;
  status: string;
  meet_link: string | null;
  teacher_name: string;
  teacher_username: string;
  package_name: string | null;
  class_count: string | null;
}

export interface AvailableSlot {
  start_time_utc: string;
  end_time_utc: string;
  duration_minutes: number;
  is_preferred: boolean;
}

export interface StudentEnrollment {
  id: number;
  package_id: number;
  package_name: string;
  subject: string;
  classes_used: number;
  classes_total: number;
  status: string;
  start_date: string;
  end_date: string | null;
}

export interface StudentMaterial {
  link_id: number;
  material_id: number;
  title: string;
  category: string;
  level: string;
  content: string;
  tags: { words?: string[] } | null;
  progress: string;
}

export interface StudentHomework {
  id: number;
  homework_id: number;
  title: string;
  content: string;
  date_due: string;
  status: string;
  submission: string | null;
  grade: {
    score?: number;
    feedback?: string;
    graded_at?: string;
  } | null;
}

export interface TeacherPublicProfile {
  username: string;
  name: string;
  bio: string | null;
  title: string | null;
  photo_url: string | null;
  languages: string[];
  subjects: string[];
  skills: string[];
  certificates: { title: string; year: string }[];
  social_links: Record<string, string>;
  average_rating: number;
  total_reviews: number;
}

export interface Review {
  id: number;
  student_name: string;
  rating: number;
  comment: string;
  created_at: string;
}

// ─── Clases del estudiante ────────────────────────────────────────────────────
export function useStudentClasses(includeHistory = false) {
  const [classes, setClasses]   = useState<StudentClass[]>([]);
  const [loading, setLoading]   = useState(true);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get(
        `/classes/my-classes?include_history=${includeHistory}`
      );
      
      // Aseguramos que siempre se guarde un arreglo
      setClasses(Array.isArray(res.data) ? res.data : (res.data?.data || []));
      
    } catch { 
      // Si la petición falla, aseguramos que el estado vuelva a ser un arreglo vacío
      setClasses([]);
    } finally { 
      setLoading(false); 
    }
  }, [includeHistory]);

  useEffect(() => { fetch(); }, [fetch]);
  return { classes, loading, refetch: fetch };
}

// ─── Slots disponibles ────────────────────────────────────────────────────────
export function useAvailableSlots(date: string, duration: number) {
  const [slots, setSlots]     = useState<AvailableSlot[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!date) return;
    setLoading(true);
    try {
      const res = await api.get(
        `/availability/featured-teacher/slots?date=${date}&duration=${duration}`
      );
      setSlots(res.data);
    } catch { }
    finally { setLoading(false); }
  }, [date, duration]);

  useEffect(() => { fetch(); }, [fetch]);
  return { slots, loading, refetch: fetch };
}

// ─── Enrollments ──────────────────────────────────────────────────────────────
export function useEnrollments() {
  const [enrollments, setEnrollments] = useState<StudentEnrollment[]>([]);
  const [loading, setLoading]         = useState(true);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get("/packages/my-enrollments");
      setEnrollments(res.data);
    } catch { }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { enrollments, loading, refetch: fetch };
}

// ─── Materiales ───────────────────────────────────────────────────────────────
export function useStudentMaterials() {
  const [materials, setMaterials] = useState<StudentMaterial[]>([]);
  const [loading, setLoading]     = useState(true);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get("/materials/student/my-materials");
      setMaterials(res.data);
    } catch { }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { materials, loading, refetch: fetch };
}

// ─── Tareas ───────────────────────────────────────────────────────────────────
export function useStudentHomework() {
  const [homeworks, setHomeworks] = useState<StudentHomework[]>([]);
  const [loading, setLoading]     = useState(true);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get("/homework/student/my-homework");
      setHomeworks(res.data);
    } catch { }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { homeworks, loading, refetch: fetch };
}

// ─── Perfil de la profesora ───────────────────────────────────────────────────
export function useFeaturedTeacher() {
  const [teacher, setTeacher] = useState<TeacherPublicProfile | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const username = process.env.NEXT_PUBLIC_FEATURED_TEACHER_USERNAME;
      const [tRes, rRes] = await Promise.all([
        api.get(`/teachers/${username}`),
        api.get(`/reviews/${username}`),
      ]);
      setTeacher(tRes.data);
      setReviews(rRes.data);
    } catch { }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { teacher, reviews, loading, refetch: fetch };
}