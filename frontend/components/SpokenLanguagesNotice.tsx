'use client'

import Link from 'next/link'
import { Languages } from 'lucide-react'
import { useMySpokenLanguages } from '@/hooks/useSpokenLanguages'
import { needsSpokenLanguages } from '@/lib/spokenLanguages'

/**
 * Aviso suave para quien ya terminó el onboarding sin indicar qué idiomas habla, o sin el nivel de alguno (Fase 8).
 * No bloquea nada. `profileHref` apunta al perfil del rol correspondiente.
 */
export default function SpokenLanguagesNotice({ profileHref }: { profileHref: string }) {
  const { languages, onboardingCompleted, loaded } = useMySpokenLanguages(true)
  if (!loaded || !needsSpokenLanguages({ onboarding_completed: onboardingCompleted, spoken_languages: languages })) return null
  return (
    <div role="status" className="bg-sky-50 border border-sky-100 text-sky-700 rounded-2xl px-4 py-3.5 flex items-center gap-3 flex-wrap">
      <Languages className="w-4 h-4 flex-shrink-0" />
      <span className="text-sm font-semibold flex-1">Agrega los idiomas que hablas y tu nivel en cada uno para que tu profesor o tus alumnos te conozcan mejor.</span>
      <Link href={profileHref} className="text-xs font-black underline">Agregar idiomas</Link>
    </div>
  )
}
