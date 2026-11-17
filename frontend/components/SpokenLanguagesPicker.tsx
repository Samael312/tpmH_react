'use client'

import { Check } from 'lucide-react'
import { useSystemCatalogs } from '@/hooks/useSystemCatalogs'
import { MAX_SPOKEN_LANGUAGES, atLimit, isSelected, toggleLanguage } from '@/lib/spokenLanguages'

interface Props {
  value: string[]
  onChange: (next: string[]) => void
  max?: number
  disabled?: boolean
  /** id del elemento que etiqueta al grupo (accesibilidad). */
  labelledBy?: string
}

/** Selector múltiple de «Idiomas que hablo». Las opciones salen del catálogo `spoken_languages` (editable por el superadmin). */
export default function SpokenLanguagesPicker({ value, onChange, max = MAX_SPOKEN_LANGUAGES, disabled = false, labelledBy }: Props) {
  const { catalogs, loading, isError, refetch } = useSystemCatalogs()
  const options = catalogs.spoken_languages ?? []
  const full = atLimit(value, max)

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
    <div className="space-y-3">
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
      </div>
      <p className="text-xs font-semibold text-slate-400" aria-live="polite">
        {value.length} de {max} seleccionados
        {full && ' · llegaste al máximo'}
      </p>
    </div>
  )
}
