'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import SpokenLanguagesPicker from '@/components/SpokenLanguagesPicker'
import { canContinue, type SpokenLanguage } from '@/lib/spokenLanguages'

interface Props {
  value: SpokenLanguage[]
  onChange: (v: SpokenLanguage[]) => void
  onNext: () => void
  onBack: () => void
  /** Textos distintos por rol: «idiomas que hablas» no es «idiomas que enseñas / quieres aprender». */
  audience: 'student' | 'teacher'
}

const COPY = {
  student: {
    title: '¿Qué idiomas hablas?',
    hint: 'Elige los idiomas que hablas (al menos uno) y tu nivel en cada uno. Ayuda a tu profesor a comunicarse contigo. No es lo que quieres aprender: eso lo eliges en tu objetivo.',
  },
  teacher: {
    title: 'Idiomas que hablas',
    hint: 'Elige los idiomas en los que puedes comunicarte con tus alumnos (al menos uno) y tu nivel en cada uno. No es lo que enseñas: los idiomas que enseñas los elegiste en el paso anterior, en «Idiomas que enseñas».',
  },
} as const

/** Paso del onboarding de alumno y profesor (Fase 8). Mínimo 1 idioma para continuar; el servidor lo vuelve a exigir al terminar. */
export default function SpokenLanguagesStep({ value, onChange, onNext, onBack, audience }: Props) {
  const copy = COPY[audience]
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto w-full">
      <h2 id="spoken-title" className="text-3xl font-black text-slate-800 tracking-tight mb-2">{copy.title}</h2>
      <p className="text-slate-500 mb-8">{copy.hint}</p>
      <div className="mb-8">
        <SpokenLanguagesPicker value={value} onChange={onChange} labelledBy="spoken-title" />
      </div>
      <div className="flex gap-4 pt-6 border-t border-slate-100">
        <button onClick={onBack} className="px-8 py-4 text-base font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors flex items-center justify-center gap-2">
          <ChevronLeft className="w-5 h-5" /> Volver
        </button>
        <button onClick={onNext} disabled={!canContinue(value)} className="flex-1 py-4 text-base font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          Continuar <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}
