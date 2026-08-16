import { useState, useEffect, useCallback } from "react";
import api from "@/lib/api";

export type BookingStage =
  | "loading"
  | "needs_trial"
  | "trial_in_progress"
  | "needs_package"
  | "package_pending_payment"
  | "needs_payment"
  | "needs_renewal"
  | "renew_required"
  | "renewal_pending"
  | "ready";
  
export interface StudentClass {
  id: number;
  class_type: "trial" | "regular";
  enrollment_id: number | null;
  subject: string | null;
  start_time_utc: string;
  end_time_utc: string;
  duration_minutes: number;
  status: string;
  meet_link: string | null;
  teacher_avatar?: string | null;
  teacher_name: string;
  teacher_username: string;
  teacher_nationality: string | null;
  package_name: string | null;
  class_count: string | null;
  teacher_phone?: string | null;
}

export interface AvailableSlot {
  start_time_utc: string;
  end_time_utc: string;
  duration_minutes: number;
  is_preferred: boolean;
  is_available: boolean;
  is_past?: boolean;
}

export interface StudentEnrollment {
  id: number;
  package_id: number;
  package: {
    id: number;
    name: string;
    subject: string;
    description: string | null;
    description_type?: "text" | "list" | string | null;
    description_items?: string[] | null;
    color?: string | null;
    icon?: string | null;
    classes_count: number | null;
    installment_count?: number;
    price: number;
    duration_minutes: number;
    is_active: boolean;
    created_at: string;
  };
  classes_used: number;
  unlocked_credits?: number;
  classes_total: number | null;
  prepaid_unlimited_credits?: number;
  available_credits?: number;
  status: string;
  installments_paid?: number;
  paid_via_installments?: boolean;
  total_installments?: number;
  pending_payment_notified?: boolean;
  renewal_requested?: boolean;
  requested_package_id?: number | null;
  payment_status?: string;
  teacher_name: string | null;
  teacher_username: string | null;
  teacher_avatar: string | null;
  created_at?: string;
  updated_at?: string;
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
  student_id: number;
  status: string; // "pending" | "submitted" | "graded"
  submission: string | null;
  submitted_at: string | null;
  score: number | null;
  feedback: string | null;
  graded_at: string | null;
  assigned_at: string;
  homework: {
    id: number;
    teacher_id: number;
    title: string;
    description: string;
    due_date_utc: string;
    is_active: boolean;
    created_at: string;
  };
}

export interface TeacherResolution {
  loading: boolean;
  isSingleTenant: boolean;
  teacherUsername: string | null;
  hasChosenTeacher: boolean;
}

export interface TeacherPublicProfile {
  username: string;
  name: string;
  surname?: string | null;
  bio: string | null;
  title: string | null;
  video_url?: string | null;
  theme_color?: string | null;
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

export function useStudentClasses(includeHistory = false) {
  const [classes, setClasses]   = useState<StudentClass[]>([]);
  const [loading, setLoading]   = useState(true);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get(
        `/classes/my-classes?include_history=${includeHistory}`
      );
      
      const rawData = res.data;
      const classList = Array.isArray(rawData) 
        ? rawData 
        : (rawData?.classes || rawData?.data || []);

      setClasses(classList);
      
    } catch (error) { 
      console.error("Error fetching student classes:", error);
      setClasses([]);
    } finally { 
      setLoading(false); 
    }
  }, [includeHistory]);

  useEffect(() => { fetch(); }, [fetch]);
  return { classes, loading, refetch: fetch };
}

export interface MyTeacherInfo {
  teacher_username: string;
  name: string | null;
  surname: string | null;
  title: string | null;
  profile_photo_url: string | null;
  theme_color: string | null;
  stage: BookingStage;
  active_enrollment: {
    id: number;
    package_name: string | null;
    classes_used: number;
    classes_total: number | null;
    status: string;
  } | null;
}

export function useMyTeachers() {
  const [teachers, setTeachers] = useState<MyTeacherInfo[]>([]);
  const [isSingleTenant, setIsSingleTenant] = useState(true);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, teachersRes] = await Promise.all([
        api.get("/admin/platform-config"),
        api.get("/users/me/teachers"),
      ]);
      setIsSingleTenant(!!cfgRes.data?.is_single_tenant);
      setTeachers(Array.isArray(teachersRes.data) ? teachersRes.data : []);
    } catch (error) {
      console.error("Error fetching my teachers:", error);
      setTeachers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return {
    loading,
    isSingleTenant,
    teachers,
    hasAnyTeacher: teachers.length > 0,
    refetch: fetch,
  };
}

export function useAvailableSlots(date: string, duration: number, teacherUsername: string | null) {
  const [slots, setSlots]     = useState<AvailableSlot[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!date || !teacherUsername) {
      setSlots([]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get(
        `/availability/${teacherUsername}/slots?date=${date}&duration=${duration}`
      );
      setSlots(res.data);
    } catch (error) {
      console.error("Error fetching available slots:", error);
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }, [date, duration, teacherUsername]);

  useEffect(() => { fetch(); }, [fetch]);
  return { slots, loading, refetch: fetch };
}

export function useEnrollments() {
  const [enrollments, setEnrollments] = useState<StudentEnrollment[]>([]);
  const [loading, setLoading]         = useState(true);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get("/packages/my-enrollments");
      setEnrollments(res.data);
    } catch (error) { 
      console.error("Error fetching enrollments:", error);
      setEnrollments([]);
    } finally { 
      setLoading(false); 
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { enrollments, loading, refetch: fetch };
}

export function useStudentMaterials() {
  const [materials, setMaterials] = useState<StudentMaterial[]>([]);
  const [loading, setLoading]     = useState(true);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get("/materials/student/my-materials");
      setMaterials(res.data);
    } catch (error) { 
      console.error("Error fetching materials:", error);
      setMaterials([]);
    } finally { 
      setLoading(false); 
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { materials, loading, refetch: fetch };
}

export function useStudentHomework() {
  const [homeworks, setHomeworks] = useState<StudentHomework[]>([]);
  const [loading, setLoading]     = useState(true);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get("/homework/student/my-homework");
      setHomeworks(res.data);
    } catch (error) { 
      console.error("Error fetching homework:", error);
      setHomeworks([]);
    } finally { 
      setLoading(false); 
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { homeworks, loading, refetch: fetch };
}

export function useFeaturedTeacher() {
  const [teacher, setTeacher] = useState<TeacherPublicProfile | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const username = process.env.NEXT_PUBLIC_FEATURED_TEACHER_USERNAME ?? "mar12";
      
      const [tRes, rRes] = await Promise.all([
        api.get(`/teachers/${username}`),
        api.get(`/reviews/${username}`),
      ]);
      setTeacher(tRes.data);
      setReviews(rRes.data);
    } catch (error) { 
      console.error("Error fetching teacher profile:", error);
      setTeacher(null);
      setReviews([]);
    } finally { 
      setLoading(false); 
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { teacher, reviews, loading, refetch: fetch };
}

export interface TeacherDirectoryItem {
  user_username: string;
  name?: string;
  surname?: string;
  bio: string | null;
  title: string | null;
  profile_photo_url: string | null;
  languages: string[];
  subjects: string[];
  skills: string[];
  average_rating?: number;
  total_reviews?: number;
  nationality?: string | null; 
}

export function useTeacherDirectory() {
  const [teachers, setTeachers] = useState<TeacherDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get("/teachers/");
      const list: TeacherDirectoryItem[] = res.data || [];

      const withRatings = await Promise.all(
        list.map(async (t) => {
          try {
            const r = await api.get(`/reviews/${t.user_username}/summary`);
            return {
              ...t,
              average_rating: r.data.average_rating,
              total_reviews: r.data.total_reviews,
            };
          } catch {
            return t;
          }
        })
      );
      setTeachers(withRatings);
    } catch (error) {
      console.error("Error fetching teachers directory:", error);
      setTeachers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { teachers, loading, refetch: fetch };
}

export interface PlatformConfigInfo {
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

export function usePlatformConfig() {
  const [config, setConfig] = useState<PlatformConfigInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get("/admin/platform-config");
      setConfig(res.data);
    } catch (error) {
      console.error("Error fetching platform config:", error);
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { config, loading, refetch: fetch };
}