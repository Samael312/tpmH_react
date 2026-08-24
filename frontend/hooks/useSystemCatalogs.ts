import { useQuery } from "@tanstack/react-query"
import api from "@/lib/api"

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

export const SYSTEM_CATALOGS_QUERY_KEY = ["system", "catalogs"] as const

export function useSystemCatalogs() {
  const query = useQuery({
    queryKey: SYSTEM_CATALOGS_QUERY_KEY,
    queryFn: async () => {
      const res = await api.get("/system-catalogs/")
      return { ...FALLBACK, ...res.data } as SystemCatalogs
    },
  })

  return {
    catalogs: query.data ?? FALLBACK,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}