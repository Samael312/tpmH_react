import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { fetchMe } from '@/lib/me'
import { useAuthStore } from '@/store/authStore'
import { parseSpoken, type SpokenLanguage } from '@/lib/spokenLanguages'

export const MY_SPOKEN_LANGUAGES_KEY = ['users', 'me', 'spoken-languages'] as const

interface MeSpoken {
  spoken_languages: SpokenLanguage[]
  onboarding_completed: boolean
}

/** Idiomas que habla el usuario autenticado (de GET /users/me) y cómo guardarlos (PATCH /users/me). */
export function useMySpokenLanguages(enabled = true) {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const setUser = useAuthStore(s => s.setUser)

  const query = useQuery({
    queryKey: MY_SPOKEN_LANGUAGES_KEY,
    enabled,
    queryFn: async (): Promise<MeSpoken> => {
      const me = await fetchMe(qc)
      return {
        spoken_languages: parseSpoken(me?.spoken_languages),
        onboarding_completed: !!me?.onboarding_completed,
      }
    },
  })

  const save = async (languages: SpokenLanguage[]): Promise<SpokenLanguage[]> => {
    const res = await api.patch('/users/me', { spoken_languages: languages })
    const saved: SpokenLanguage[] = parseSpoken(res.data?.spoken_languages ?? languages)
    qc.setQueryData<MeSpoken>(MY_SPOKEN_LANGUAGES_KEY, prev => ({
      onboarding_completed: prev?.onboarding_completed ?? true,
      spoken_languages: saved,
    }))
    if (user) setUser({ ...user, spoken_languages: saved })
    return saved
  }

  return {
    languages: query.data?.spoken_languages ?? [],
    onboardingCompleted: query.data?.onboarding_completed ?? false,
    loaded: query.isSuccess,
    loading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    save,
  }
}
