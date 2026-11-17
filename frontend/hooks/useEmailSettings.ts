import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import type { EmailSettings } from '@/lib/emailSettings'

export const EMAIL_SETTINGS_KEY = ['admin', 'settings', 'email-settings'] as const

/** Solo el superadmin puede leer esto (el backend responde 403 al resto): pasa `enabled=false` para otros roles. */
export function useEmailSettings(enabled = true) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: EMAIL_SETTINGS_KEY,
    enabled,
    queryFn: async () => (await api.get('/admin/email-settings')).data as EmailSettings,
    refetchInterval: 60_000,
  })

  const save = async (body: Record<string, unknown>) => {
    const res = await api.put('/admin/email-settings', body)
    qc.setQueryData(EMAIL_SETTINGS_KEY, res.data as EmailSettings)
    return res.data as EmailSettings
  }

  return {
    settings: query.data ?? null,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
    save,
  }
}
