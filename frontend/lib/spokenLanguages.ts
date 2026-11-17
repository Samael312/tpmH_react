// Fases 8 y 10: idiomas que HABLA el usuario y su nivel. Lógica pura (sin React) para poder testearla con Vitest.
// No confundir con `TeacherProfile.languages` (los idiomas que el profesor ENSEÑA).
// El servidor es la barrera real (catálogo, máximo 10, sin repetidos, nivel obligatorio); esto solo guía la interfaz.

export const MAX_SPOKEN_LANGUAGES = 10

export type SpokenLevel = 'native' | 'fluent' | 'intermediate' | 'basic'

/** Del nivel más alto al más bajo (mismo orden que el servidor). */
export const SPOKEN_LEVELS: SpokenLevel[] = ['native', 'fluent', 'intermediate', 'basic']

export const LEVEL_LABELS: Record<SpokenLevel, string> = {
  native: 'Nativo',
  fluent: 'Fluido',
  intermediate: 'Intermedio',
  basic: 'Básico',
}

/** `level` es null solo en datos de la Fase 8 (aún sin nivel): se muestran y se pide completarlos. */
export interface SpokenLanguage {
  language: string
  level: SpokenLevel | null
}

/** Clave de comparación: sin tildes, sin mayúsculas ni espacios sobrantes (igual que el servidor). */
export function languageKey(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

/** Acepta lo que devuelva la API (objetos, o textos sueltos antiguos) y lo deja como SpokenLanguage[]. */
export function parseSpoken(raw: unknown): SpokenLanguage[] {
  if (!Array.isArray(raw)) return []
  const out: SpokenLanguage[] = []
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) out.push({ language: item.trim(), level: null })
    else if (item && typeof item === 'object' && typeof (item as { language?: unknown }).language === 'string') {
      const { language, level } = item as { language: string; level?: unknown }
      if (!language.trim()) continue
      out.push({
        language: language.trim(),
        level: SPOKEN_LEVELS.includes(level as SpokenLevel) ? (level as SpokenLevel) : null,
      })
    }
  }
  return out
}

/** Marca o desmarca un idioma respetando el máximo. Un idioma nuevo entra SIN nivel (el usuario lo elige). */
export function toggleLanguage(selected: SpokenLanguage[], language: string, max: number = MAX_SPOKEN_LANGUAGES): SpokenLanguage[] {
  const key = languageKey(language)
  if (selected.some(s => languageKey(s.language) === key)) return selected.filter(s => languageKey(s.language) !== key)
  if (selected.length >= max) return selected
  return [...selected, { language, level: null }]
}

/** Cambia el nivel de un idioma ya elegido (lista nueva; si el idioma no está, no cambia nada). */
export function setLevel(selected: SpokenLanguage[], language: string, level: SpokenLevel): SpokenLanguage[] {
  const key = languageKey(language)
  return selected.map(s => (languageKey(s.language) === key ? { ...s, level } : s))
}

export function isSelected(selected: SpokenLanguage[], language: string): boolean {
  const key = languageKey(language)
  return selected.some(s => languageKey(s.language) === key)
}

export function levelOf(selected: SpokenLanguage[], language: string): SpokenLevel | null {
  const key = languageKey(language)
  return selected.find(s => languageKey(s.language) === key)?.level ?? null
}

/** Todos los idiomas elegidos tienen nivel (el servidor lo exige al guardar). */
export function allHaveLevel(selected: SpokenLanguage[]): boolean {
  return selected.every(s => s.level !== null)
}

/** El onboarding exige al menos un idioma y que cada uno tenga su nivel. */
export function canContinue(selected: SpokenLanguage[]): boolean {
  return selected.length >= 1 && allHaveLevel(selected)
}

export function atLimit(selected: SpokenLanguage[], max: number = MAX_SPOKEN_LANGUAGES): boolean {
  return selected.length >= max
}

/** «Habla: español (nativo), inglés (intermedio)» en minúsculas, o null si no hay idiomas. Sin nivel, solo el nombre. */
export function formatSpoken(languages: SpokenLanguage[] | null | undefined): string | null {
  const list = parseSpoken(languages)
  if (!list.length) return null
  const text = list
    .map(l => (l.level ? `${l.language.toLowerCase()} (${LEVEL_LABELS[l.level].toLowerCase()})` : l.language.toLowerCase()))
    .join(', ')
  return `Habla: ${text}`
}

/**
 * Un usuario que ya terminó el onboarding y no tiene idiomas, o los tiene sin nivel (datos de la Fase 8),
 * ve un aviso suave (no bloquea nada).
 */
export function needsSpokenLanguages(
  user: { onboarding_completed?: boolean; spoken_languages?: SpokenLanguage[] } | null | undefined,
): boolean {
  if (!user || !user.onboarding_completed) return false
  const list = parseSpoken(user.spoken_languages)
  return list.length === 0 || !allHaveLevel(list)
}

/** Dos listas iguales (mismos idiomas y mismos niveles), sin importar el orden. */
export function sameLanguages(a: SpokenLanguage[], b: SpokenLanguage[]): boolean {
  if (a.length !== b.length) return false
  const byKey = new Map(a.map(x => [languageKey(x.language), x.level]))
  return b.every(x => byKey.has(languageKey(x.language)) && byKey.get(languageKey(x.language)) === x.level)
}
