'use client'

import { useEffect, useState } from 'react'
import { Languages } from 'lucide-react'
import SpokenLanguagesPicker from '@/components/SpokenLanguagesPicker'
import SpokenLanguagesNotice from '@/components/SpokenLanguagesNotice'
import { useMySpokenLanguages } from '@/hooks/useSpokenLanguages'
import { useToast } from '@/hooks/useToast'
import { getErrorMessage } from '@/lib/errorMessage'
import { allHaveLevel, sameLanguages, type SpokenLanguage } from '@/lib/spokenLanguages'

/** Sección «Idiomas que hablo» del perfil (alumno y profesor). Guarda con PATCH /users/me y avisa con un toast. */
export default function SpokenLanguagesSection({ profileHref, audience }: { profileHref: string; audience: 'student' | 'teacher' }) {
  const toast = useToast()
  const { languages, loaded, isError, refetch, save } = useMySpokenLanguages(true)
  const [draft, setDraft] = useState<SpokenLanguage[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (loaded) setDraft(languages) }, [loaded, languages])

  const changed = loaded && !sameLanguages(draft, languages)
  const canSave = changed && allHaveLevel(draft)   // el servidor exige el nivel de cada idioma

  const onSave = async () => {
    setSaving(true)
    try {
      await save(draft)
      toast.success('Idiomas guardados')
    } catch (e) {
      toast.error(getErrorMessage(e, 'No se pudieron guardar los idiomas'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <SpokenLanguagesNotice profileHref={profileHref} />
      <div className="bg-white/85 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg shadow-slate-100 p-6 sm:p-7">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-pink-50 flex items-center justify-center flex-shrink-0 text-pink-500">
            <Languages className="w-5 h-5" />
          </div>
          <div>
            <h2 id="spoken-section-title" className="text-lg font-black text-slate-800 tracking-tight">Idiomas que hablo</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {audience === 'teacher'
                ? 'Los verán tus alumnos en tu perfil público. No son los idiomas que enseñas.'
                : 'Solo los verá tu profesor. No son los idiomas que quieres aprender.'}
            </p>
          </div>
        </div>

        {isError ? (
          <p className="text-sm font-semibold text-rose-500">
            No se pudieron cargar tus idiomas. <button type="button" onClick={() => refetch()} className="underline">Reintentar</button>
          </p>
        ) : (
          <>
            <SpokenLanguagesPicker value={draft} onChange={setDraft} labelledBy="spoken-section-title" disabled={!loaded} />
            <div className="flex justify-end pt-5">
              <button
                type="button"
                onClick={onSave}
                disabled={!canSave || saving}
                className="px-6 py-3 text-sm font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-md shadow-pink-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Guardando…' : 'Guardar idiomas'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
