// Fase 7: lógica pura del panel de control de correos (sin React, testeable con Vitest).

export type EmailProbability = 'muy_alta' | 'alta' | 'media' | 'baja'

export interface EmailCategory {
  key: string
  label: string
  probability: EmailProbability
  essential: boolean
  enabled: boolean
  sent_today: number
  skipped_today: number
  failed_today: number
  emails: string[]
}

export interface EmailSettings {
  categories: EmailCategory[]
  sent_today: number
  daily_limit: number
  auto_saver_enabled: boolean
  auto_saver_percent: number
  auto_saver_active: boolean
  skipped_today: number
  failed_today: number
  alert: boolean
}

export const PROBABILITY_LABEL: Record<EmailProbability, string> = {
  muy_alta: 'Muy alta',
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
}

// Estimación a partir del código (no una medición): ver CORRECCIONES.md, Fase 7.
export const PROBABILITY_STYLE: Record<EmailProbability, string> = {
  muy_alta: 'bg-rose-50 text-rose-600 border-rose-100',
  alta: 'bg-orange-50 text-orange-600 border-orange-100',
  media: 'bg-amber-50 text-amber-600 border-amber-100',
  baja: 'bg-emerald-50 text-emerald-600 border-emerald-100',
}

/** Porcentaje de la cuota diaria usado hoy, acotado a 0–100. */
export function quotaPercent(sent: number, limit: number): number {
  if (!limit || limit <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((sent / limit) * 100)))
}

/** Texto «37 / 100» para el contador de uso. */
export function usageLabel(sent: number, limit: number): string {
  return `${sent} / ${limit}`
}

/** Mensaje del banner del panel, o null si no hay nada que avisar. */
export function alertMessage(s: Pick<EmailSettings, 'skipped_today' | 'failed_today' | 'alert'> | null | undefined): string | null {
  if (!s || !s.alert) return null
  const parts: string[] = []
  if (s.skipped_today) parts.push(`${s.skipped_today} correo${s.skipped_today === 1 ? '' : 's'} omitido${s.skipped_today === 1 ? '' : 's'}`)
  if (s.failed_today) parts.push(`${s.failed_today} fallido${s.failed_today === 1 ? '' : 's'}`)
  return parts.length ? `Hoy hay ${parts.join(' y ')} por cuota o configuración de correos.` : null
}

/** Cuerpo del PUT: solo lo que cambió respecto a lo guardado, sin las esenciales (no se pueden apagar). */
export function buildUpdate(
  saved: EmailSettings,
  draft: { enabled: Record<string, boolean>; daily_limit: number; auto_saver_enabled: boolean; auto_saver_percent: number },
) {
  const notifications: Record<string, boolean> = {}
  for (const c of saved.categories) {
    if (c.essential) continue
    if (draft.enabled[c.key] !== undefined && draft.enabled[c.key] !== c.enabled) notifications[c.key] = draft.enabled[c.key]
  }
  const body: {
    notifications?: Record<string, boolean>
    daily_limit?: number
    auto_saver_enabled?: boolean
    auto_saver_percent?: number
  } = {}
  if (Object.keys(notifications).length) body.notifications = notifications
  if (draft.daily_limit !== saved.daily_limit) body.daily_limit = draft.daily_limit
  if (draft.auto_saver_enabled !== saved.auto_saver_enabled) body.auto_saver_enabled = draft.auto_saver_enabled
  if (draft.auto_saver_percent !== saved.auto_saver_percent) body.auto_saver_percent = draft.auto_saver_percent
  return body
}
