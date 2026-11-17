// Fase 8: idiomas que HABLA el usuario. Lógica pura (sin React) para poder testearla con Vitest.
// No confundir con `TeacherProfile.languages` (los idiomas que el profesor ENSEÑA).
// El servidor es la barrera real (catálogo, máximo 10, sin repetidos); esto solo guía la interfaz.

export const MAX_SPOKEN_LANGUAGES = 10

/** Clave de comparación: sin tildes, sin mayúsculas ni espacios sobrantes (igual que el servidor). */
export function languageKey(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

/** Marca o desmarca un idioma respetando el máximo. Devuelve una lista nueva; no repite idiomas. */
export function toggleLanguage(selected: string[], language: string, max: number = MAX_SPOKEN_LANGUAGES): string[] {
  const key = languageKey(language)
  if (selected.some(s => languageKey(s) === key)) return selected.filter(s => languageKey(s) !== key)
  if (selected.length >= max) return selected
  return [...selected, language]
}

export function isSelected(selected: string[], language: string): boolean {
  const key = languageKey(language)
  return selected.some(s => languageKey(s) === key)
}

/** El onboarding exige al menos un idioma. */
export function canContinue(selected: string[]): boolean {
  return selected.length >= 1
}

export function atLimit(selected: string[], max: number = MAX_SPOKEN_LANGUAGES): boolean {
  return selected.length >= max
}

/** «Habla: español, inglés» (en minúsculas, como en las tarjetas), o null si no hay idiomas. */
export function formatSpoken(languages: string[] | null | undefined): string | null {
  const list = (languages ?? []).filter(l => typeof l === 'string' && l.trim())
  if (!list.length) return null
  return `Habla: ${list.map(l => l.trim().toLowerCase()).join(', ')}`
}

/** Un usuario que ya terminó el onboarding pero no tiene idiomas ve un aviso suave (no bloquea nada). */
export function needsSpokenLanguages(
  user: { onboarding_completed?: boolean; spoken_languages?: string[] } | null | undefined,
): boolean {
  if (!user || !user.onboarding_completed) return false
  return !(user.spoken_languages && user.spoken_languages.length)
}

/** Dos listas con los mismos idiomas, sin importar el orden. */
export function sameLanguages(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const keys = new Set(a.map(languageKey))
  return b.every(x => keys.has(languageKey(x)))
}
