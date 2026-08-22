import { useState, useEffect, useCallback } from "react";
import api from "@/lib/api";

export interface StudentGoal { text: string; desc: string; icon: string }
export interface PaymentMethodOption { value: string; label: string; icon: string }
export interface ThemePreset { label: string; value: string }
export interface SubjectTheme { icon: string; color: string }

export interface SystemCatalogs {
  subjects: string[];
  languages: string[];
  skill_suggestions: string[];
  student_goals: StudentGoal[];
  student_payment_methods: PaymentMethodOption[];
  withdrawal_methods: PaymentMethodOption[];
  material_categories: string[];
  material_levels: string[];
  theme_presets: ThemePreset[];
  package_icon_options: string[];
  subject_theme_map: Record<string, SubjectTheme>;
}

const FALLBACK: SystemCatalogs = {
  subjects: [], languages: [], skill_suggestions: [], student_goals: [],
  student_payment_methods: [], withdrawal_methods: [], material_categories: [],
  material_levels: [], theme_presets: [], package_icon_options: [], subject_theme_map: {},
};

let cache: SystemCatalogs | null = null;

export function useSystemCatalogs() {
  // Tipamos explícitamente el useState para evitar conflictos de tipos con null
  const [catalogs, setCatalogs] = useState<SystemCatalogs>(cache ?? FALLBACK);
  const [loading, setLoading] = useState<boolean>(!cache);

  const fetchCatalogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/system-catalogs/");
      cache = { ...FALLBACK, ...res.data };
      setCatalogs(cache as SystemCatalogs);
    } catch {
      setCatalogs(FALLBACK);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cache) { 
      setCatalogs(cache); 
      setLoading(false); 
      return; 
    }
    fetchCatalogs();
  }, [fetchCatalogs]);

  return { catalogs, loading, refetch: fetchCatalogs };
}