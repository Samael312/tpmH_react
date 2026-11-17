'use client'

import { Check } from 'lucide-react'
import { useSystemCatalogs } from '@/hooks/useSystemCatalogs'
import {
  LEVEL_LABELS, MAX_SPOKEN_LANGUAGES, SPOKEN_LEVELS, atLimit, isSelected, outsideCatalog, setLevel, toggleLanguage,
  type SpokenLanguage,
} from '@/lib/spokenLanguages'

interface Props {
  value: SpokenLanguage[]
  onChange: (next: SpokenLanguage[]) => void
  max?: number
  disabled?: boolean
  /** id del elemento que etiqueta al grupo (accesibilidad). */
  labelledBy?: string
}

/**
 * Selector múltiple de «Idiomas que hablo» con el nivel de cada uno. Las opciones salen del catálogo
 * `spoken_languages` (editable por el superadmin); el nivel es obligatorio (el servidor lo exige).
 */
export default function SpokenLanguagesPicker({ value, onChange, max = MAX_SPOKEN_LANGUAGES, disabled = false, labelledBy }: Props) {
  const { catalogs, loading, isError, refetch } = useSystemCatalogs()
  const options = catalogs.spoken_languages ?? []
  const full = atLimit(value, max)
  const missing = value.filter(v => v.level === null).length
  const retired = outsideCatalog(value, options)

  if (loading) return <p className="text-sm font-semibold text-slate-400">Cargando idiomas…</p>
  if (isError || !options.length) {
    return (
      <p className="text-sm font-semibold text-rose-500">
        No se pudo cargar la lista de idiomas.{' '}
        <button type="button" onClick={() => refetch()} className="underline">Reintentar</button>
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
        {options.map(lang => {
          const on = isSelected(value, lang)
          const blocked = disabled || (!on && full)
          return (
            <button
              key={lang}
              type="button"
              aria-pressed={on}
              disabled={blocked}
              onClick={() => onChange(toggleLanguage(value, lang, max))}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                on ? 'bg-pink-500 border-pink-500 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:border-pink-300'
              }`}
            >
              {on && <Check className="w-4 h-4" />}
              {lang}
            </button>
          )
        })}
        {retired.map(item => (
          <button
            key={`retired-${item.language}`}
            type="button"
            aria-pressed
            disabled={disabled}
            title="Este idioma ya no está en la lista. Quítalo para poder guardar."
            onClick={() => onChange(toggleLanguage(value, item.language, max))}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-40"
          >
            {item.language} · ya no disponible, quitar ✕
          </button>
        ))}
      </div>

      {value.length > 0 && (
        <ul className="space-y-2" aria-label="Nivel de cada idioma">
          {value.map(item => (
            <li key={item.language} className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-slate-50 rounded-2xl px-4 py-3">
              <span className="text-sm font-black text-slate-700 min-w-[6rem]">{item.language}</span>
              <div role="radiogroup" aria-label={`Nivel de ${item.language}`} className="flex flex-wrap gap-1.5">
                {SPOKEN_LEVELS.map(level => {
                  const active = item.level === level
                  return (
                    <button
                      key={level}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={`${item.language}: ${LEVEL_LABELS[level]}`}
                      disabled={disabled}
                      onClick={() => onChange(setLevel(value, item.language, level))}
                      className={`px-3 py-1 rounded-full text-xs font-bold border transition-all disabled:opacity-40 ${
                        active ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'
                      }`}
                    >
                      {LEVEL_LABELS[level]}
                    </button>
                  )
                })}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs font-semibold text-slate-400" aria-live="polite">
        {value.length} de {max} seleccionados
        {full && ' · llegaste al máximo'}
        {missing > 0 && <span className="text-amber-600"> · elige el nivel de {missing === 1 ? 'un idioma' : `${missing} idiomas`}</span>}
      </p>
    </div>
  )
}
