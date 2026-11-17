import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/authStore'

export const MY_SPOKEN_LANGUAGES_KEY = ['users', 'me', 'spoken-languages'] as const

interface MeSpoken {
  spoken_languages: string[]
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
      const res = await api.get('/users/me')
      return {
        spoken_languages: Array.isArray(res.data?.spoken_languages) ? res.data.spoken_languages : [],
        onboarding_completed: !!res.data?.onboarding_completed,
      }
    },
  })

  const save = async (languages: string[]): Promise<string[]> => {
    const res = await api.patch('/users/me', { spoken_languages: languages })
    const saved: string[] = res.data?.spoken_languages ?? languages
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
