'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Card, Button } from '@/components/ui'
import Skeleton from '@/components/ui/Skeleton'
import { useToast } from '@/hooks/useToast'
import { getErrorMessage } from '@/lib/errorMessage'
import { useEmailSettings } from '@/hooks/useEmailSettings'
import {
  PROBABILITY_LABEL, PROBABILITY_STYLE, alertMessage, buildUpdate, quotaPercent, usageLabel,
} from '@/lib/emailSettings'

/** Pestaña «Correos» de /admin/settings (solo superadmin). */
export default function EmailSettingsPanel() {
  const toast = useToast()
  const { settings, isError, refetch, save } = useEmailSettings(true)

  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [limit, setLimit] = useState(100)
  const [saver, setSaver] = useState(false)
  const [saverPct, setSaverPct] = useState(80)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  // Copia editable: solo se sincroniza con el servidor si no hay cambios sin guardar.
  useEffect(() => {
    if (!settings || dirty) return
    setEnabled(Object.fromEntries(settings.categories.map(c => [c.key, c.enabled])))
    setLimit(settings.daily_limit)
    setSaver(settings.auto_saver_enabled)
    setSaverPct(settings.auto_saver_percent)
  }, [settings, dirty])

  if (isError) {
    return (
      <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl px-4 py-3.5 flex items-center gap-3 flex-wrap">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        <span className="text-sm font-semibold flex-1">No se pudo cargar la configuración de correos.</span>
        <Button variant="secondary" onClick={() => refetch()} className="!rounded-xl !py-2 !px-4 text-xs">Reintentar</Button>
      </div>
    )
  }
  if (!settings) return <Skeleton className="h-32 w-full rounded-2xl" />

  const pct = quotaPercent(settings.sent_today, settings.daily_limit)
  const message = alertMessage(settings)

  const onSave = async () => {
    const body = buildUpdate(settings, { enabled, daily_limit: limit, auto_saver_enabled: saver, auto_saver_percent: saverPct })
    if (!Object.keys(body).length) { setDirty(false); return }
    setSaving(true)
    try {
      await save(body)
      setDirty(false)
      toast.success('Configuración de correos guardada')
    } catch (e) {
      toast.error(getErrorMessage(e, 'No se pudo guardar la configuración de correos'))
    } finally {
      setSaving(false)
    }
  }

  const touch = () => setDirty(true)

  return (
    <div className="space-y-6">
      {message && (
        <div role="alert" className="bg-amber-50 border border-amber-100 text-amber-700 rounded-2xl px-4 py-3.5 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-semibold">{message}</span>
        </div>
      )}

      <Card className="p-6 md:p-8 space-y-6">
        <div>
          <h3 className="text-slate-800 font-black text-lg">Notificaciones por email</h3>
          <p className="text-slate-500 text-sm font-medium mt-1">
            El plan gratuito de Resend permite 100 correos al día. Apaga las categorías que no necesites para no agotar la cuota.
            La probabilidad es una estimación a partir del código, no una medición.
          </p>
        </div>

        {/* Uso de hoy */}
        <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-slate-700 text-sm font-bold">Enviados hoy (UTC)</p>
            <p className="text-slate-800 text-sm font-black" data-testid="email-usage">{usageLabel(settings.sent_today, settings.daily_limit)}</p>
          </div>
          <div className="h-2 rounded-full bg-slate-200 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Cuota diaria de correos usada">
            <div className={`h-full ${pct >= 80 ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
          </div>
          {settings.auto_saver_active && (
            <p className="text-xs font-bold text-amber-600">Modo ahorro activo: las categorías de probabilidad muy alta y alta están en pausa hasta mañana.</p>
          )}
        </div>

        {/* Interruptores */}
        <ul className="divide-y divide-slate-100">
          {settings.categories.map(c => (
            <li key={c.key} className="py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-slate-800 text-sm font-bold">{c.label}</p>
                  <span className={`text-[10px] font-black uppercase tracking-wider border rounded-full px-2 py-0.5 ${PROBABILITY_STYLE[c.probability]}`}>
                    {PROBABILITY_LABEL[c.probability]}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-medium mt-1">
                  Hoy: {c.sent_today} enviados
                  {c.skipped_today > 0 && ` · ${c.skipped_today} omitidos`}
                  {c.failed_today > 0 && ` · ${c.failed_today} fallidos`}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={c.essential ? true : !!enabled[c.key]}
                aria-label={c.essential ? `${c.label} (siempre activo)` : `Enviar: ${c.label}`}
                disabled={c.essential}
                onClick={() => { setEnabled(prev => ({ ...prev, [c.key]: !prev[c.key] })); touch() }}
                className={`relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${
                  (c.essential || enabled[c.key]) ? 'bg-emerald-500 shadow-inner' : 'bg-slate-200'}`}
              >
                <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform duration-300 shadow-sm ${
                  (c.essential || enabled[c.key]) ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </li>
          ))}
        </ul>

        {/* Límite y modo ahorro */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label htmlFor="email-daily-limit" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
              Límite diario de correos
            </label>
            <input
              id="email-daily-limit" type="number" min={1}
              value={limit}
              onChange={e => { setLimit(Math.max(1, Number(e.target.value) || 1)); touch() }}
              className="w-full md:w-48 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-pink-50 focus:border-pink-300 transition-all"
            />
            <p className="text-xs text-slate-500 font-medium ml-1">Cámbialo si pasas a un plan de pago. Al llegar al límite solo salen los correos esenciales.</p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-slate-800 text-sm font-bold">Modo ahorro automático</p>
                <p className="text-slate-500 text-xs font-medium mt-1">Pausa las categorías de probabilidad muy alta y alta al llegar al porcentaje. Las esenciales nunca se pausan.</p>
              </div>
              <button
                type="button" role="switch" aria-checked={saver} aria-label="Modo ahorro automático"
                onClick={() => { setSaver(v => !v); touch() }}
                className={`relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none shrink-0 ${saver ? 'bg-emerald-500 shadow-inner' : 'bg-slate-200'}`}
              >
                <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform duration-300 shadow-sm ${saver ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </div>
            <div className="space-y-2">
              <label htmlFor="email-saver-percent" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                Pausar al llegar al (%)
              </label>
              <input
                id="email-saver-percent" type="number" min={1} max={100} disabled={!saver}
                value={saverPct}
                onChange={e => { setSaverPct(Math.min(100, Math.max(1, Number(e.target.value) || 1))); touch() }}
                className="w-full md:w-32 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-pink-50 focus:border-pink-300 transition-all disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="primary" loading={saving} disabled={!dirty} onClick={onSave}
            className="md:w-auto w-full px-8 py-3 !rounded-2xl shadow-md shadow-pink-200">
            Guardar correos
          </Button>
        </div>
      </Card>
    </div>
  )
}
