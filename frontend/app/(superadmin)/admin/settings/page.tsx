'use client'

import { useState, useEffect } from 'react'
import { Card, Button } from '@/components/ui'
import api from '@/lib/api'
import ChipiWidget from '@/components/chipi/ChipiWidget'

import {
  useAdminPaymentConfig, useAdminPlatformConfig, useAdminBusinessRules,
  AdminPaymentConfig, AdminPlatformConfig,
} from '@/hooks/useAdminData'
import { useSystemCatalogs } from '@/hooks/useSystemCatalogs'
import Skeleton from '@/components/ui/Skeleton'
import RefreshButton from '@/components/ui/RefreshButton'
import DesktopOnly from '@/components/ui/DesktopOnly'
import { usePageTopBar } from '@/lib/mobileTopBar'
import { AlertTriangle, RefreshCw } from 'lucide-react'

function CatalogEditor({ catalogKey, label, items, onSave }: {
  catalogKey: string; label: string; items: string[]; onSave: (v: string[]) => Promise<void>;
}) {
  const [list, setList] = useState(items)
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => setList(items), [items])

  const add = () => { const v = input.trim(); if (v && !list.includes(v)) { setList([...list, v]); setInput('') } }
  const remove = (v: string) => setList(list.filter(x => x !== v))
  const save = async () => { setSaving(true); try { await onSave(list) } finally { setSaving(false) } }

  return (
    <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-3">
      <p className="text-xs font-black text-slate-700">{label}</p>
      <div className="flex flex-wrap gap-2">
        {list.map(v => (
          <span key={v} className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-xs font-bold text-slate-700 px-3 py-1.5 rounded-xl">
            {v}
            <button onClick={() => remove(v)} className="text-slate-300 hover:text-rose-400">✕</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="Añadir..." className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        <button onClick={add} className="px-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-bold">+</button>
        <button onClick={save} disabled={saving} className="px-4 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold disabled:opacity-50">
          {saving ? '...' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}

// Categorías de objetivo. La plataforma no es solo de idiomas, así que
// los objetivos sugeridos se agrupan (idiomas vs. otras materias) y el
// admin edita cada grupo por separado. Si en BD todavía hubiera una
// lista plana vieja (pre-migración), la tratamos como el grupo "idiomas".
const GOAL_CATEGORY_TABS = [
  { key: 'idiomas', label: 'Idiomas' },
  { key: 'academico', label: 'Otras materias' },
]

function GoalsEditor({ items, onSave }: { items: any; onSave: (v: Record<string, any[]>) => Promise<void> }) {
  const normalized: Record<string, any[]> = Array.isArray(items)
    ? { idiomas: items }
    : (items && typeof items === 'object' ? items : {})

  const [grouped, setGrouped] = useState<Record<string, any[]>>(normalized)
  const [tab, setTab] = useState<string>(GOAL_CATEGORY_TABS[0].key)
  const [saving, setSaving] = useState(false)

  useEffect(() => setGrouped(Array.isArray(items) ? { idiomas: items } : (items && typeof items === 'object' ? items : {})), [items])

  const list = grouped[tab] ?? []
  const setList = (next: any[]) => setGrouped({ ...grouped, [tab]: next })

  const update = (i: number, field: string, value: string) => {
    const next = [...list]; next[i] = { ...next[i], [field]: value }; setList(next)
  }
  const remove = (i: number) => setList(list.filter((_, idx) => idx !== i))
  const add = () => setList([...list, { text: '', desc: '', icon: '🎯' }])
  const save = async () => { setSaving(true); try { await onSave(grouped) } finally { setSaving(false) } }

  return (
    <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-3">
      <p className="text-xs font-black text-slate-700">Objetivos de aprendizaje</p>
      <p className="text-[10px] text-slate-400">
        Se muestran agrupados por categoría en el onboarding, porque las sugerencias de idiomas
        (ej. TOEFL, pronunciación) no aplican a otras materias (ej. Matemática, Música).
      </p>

      <div className="flex gap-2">
        {GOAL_CATEGORY_TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              tab === t.key ? 'bg-pink-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {list.map((g, i) => (
          <div key={i} className="flex gap-2 items-center bg-white border border-slate-200 rounded-xl p-2">
            <input value={g.icon} onChange={e => update(i, 'icon', e.target.value)}
              className="w-12 text-center border border-slate-200 rounded-lg py-1.5" />
            <input value={g.text} onChange={e => update(i, 'text', e.target.value)}
              placeholder="Título" className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
            <input value={g.desc} onChange={e => update(i, 'desc', e.target.value)}
              placeholder="Descripción" className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
            <button onClick={() => remove(i)} className="text-slate-300 hover:text-rose-400 px-2">✕</button>
          </div>
        ))}
        {!list.length && (
          <p className="text-xs text-slate-400 italic px-1">Sin objetivos en esta categoría todavía.</p>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={add} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold">+ Añadir objetivo</button>
        <button onClick={save} disabled={saving} className="px-4 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold disabled:opacity-50">
          {saving ? '...' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}

function ThemePresetsEditor({ items, onSave }: { items: any[]; onSave: (v: any[]) => Promise<void> }) {
  const [list, setList] = useState(items)
  const [saving, setSaving] = useState(false)
  useEffect(() => setList(items), [items])

  const update = (i: number, field: string, value: string) => {
    const next = [...list]; next[i] = { ...next[i], [field]: value }; setList(next)
  }
  const remove = (i: number) => setList(list.filter((_, idx) => idx !== i))
  const add = () => setList([...list, { label: '', value: '#000000' }])
  const save = async () => { setSaving(true); try { await onSave(list) } finally { setSaving(false) } }

  return (
    <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-3">
      <p className="text-xs font-black text-slate-700">Colores de tema</p>
      <div className="flex flex-wrap gap-2">
        {list.map((t, i) => (
          <div key={i} className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1.5 pr-2">
            <input type="color" value={t.value} onChange={e => update(i, 'value', e.target.value)}
              className="w-7 h-7 rounded-lg border-0 cursor-pointer" />
            <input value={t.label} onChange={e => update(i, 'label', e.target.value)}
              className="w-20 border-0 text-xs font-bold outline-none" />
            <button onClick={() => remove(i)} className="text-slate-300 hover:text-rose-400">✕</button>
          </div>
        ))}
        <button onClick={add} className="px-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold">+</button>
      </div>
      <button onClick={save} disabled={saving} className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold disabled:opacity-50">
        {saving ? '...' : 'Guardar'}
      </button>
    </div>
  )
}

function SubjectThemeMapEditor({ subjects, languages, map, onSave }: {
  subjects: string[]; languages: string[]; map: Record<string, any>; onSave: (v: any) => Promise<void>
}) {
  const [local, setLocal] = useState(map)
  const [saving, setSaving] = useState(false)
  useEffect(() => setLocal(map), [map])

  const allKeys = [...subjects, ...languages]
  const update = (key: string, field: string, value: string) => {
    setLocal({ ...local, [key]: { ...(local[key] || { icon: '📚', color: '#3b82f6' }), [field]: value } })
  }
  const save = async () => { setSaving(true); try { await onSave(local) } finally { setSaving(false) } }

  return (
    <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-3">
      <p className="text-xs font-black text-slate-700">Tema sugerido por materia/idioma</p>
      <p className="text-[10px] text-slate-400">Se usa como icono/color por defecto al crear paquetes. Se autogenera para materias/idiomas nuevos que aún no tengan tema.</p>
      <div className="grid grid-cols-2 gap-2 max-h-80 overflow-y-auto">
        {allKeys.map(key => {
          const t = local[key] || { icon: '📚', color: '#3b82f6' }
          return (
            <div key={key} className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl p-2">
              <input value={t.icon} onChange={e => update(key, 'icon', e.target.value)} className="w-10 text-center border border-slate-200 rounded-lg" />
              <input type="color" value={t.color} onChange={e => update(key, 'color', e.target.value)} className="w-7 h-7 rounded-lg border-0 cursor-pointer" />
              <span className="text-xs font-bold text-slate-600 truncate flex-1">{key}</span>
            </div>
          )
        })}
      </div>
      <button onClick={save} disabled={saving} className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold disabled:opacity-50">
        {saving ? '...' : 'Guardar'}
      </button>
    </div>
  )
}

function PaymentMethodsEditor({ title, items, onSave }: { title: string; items: any[]; onSave: (v: any[]) => Promise<void> }) {
  const [list, setList] = useState(items)
  const [saving, setSaving] = useState(false)
  useEffect(() => setList(items), [items])

  const update = (i: number, field: string, value: string) => {
    const next = [...list]; next[i] = { ...next[i], [field]: value }; setList(next)
  }
  const remove = (i: number) => setList(list.filter((_, idx) => idx !== i))
  const add = () => setList([...list, { value: '', label: '', icon: '💳' }])
  const save = async () => { setSaving(true); try { await onSave(list) } finally { setSaving(false) } }

  return (
    <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-3">
      <p className="text-xs font-black text-slate-700">{title}</p>
      <div className="space-y-2">
        {list.map((m, i) => (
          <div key={i} className="flex gap-2 items-center bg-white border border-slate-200 rounded-xl p-2">
            <input value={m.icon} onChange={e => update(i, 'icon', e.target.value)} className="w-12 text-center border border-slate-200 rounded-lg py-1.5" />
            <input value={m.value} onChange={e => update(i, 'value', e.target.value)} placeholder="valor interno (ej: Paypal)" className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
            <input value={m.label} onChange={e => update(i, 'label', e.target.value)} placeholder="etiqueta visible" className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
            <button onClick={() => remove(i)} className="text-slate-300 hover:text-rose-400 px-2">✕</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={add} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold">+ Añadir método</button>
        <button onClick={save} disabled={saving} className="px-4 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold disabled:opacity-50">
          {saving ? '...' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}

// Pool fijo de duraciones — ya no es un catálogo de texto libre. El
// superadmin solo puede elegir subconjuntos de estas 4 opciones.
const CLASS_DURATION_OPTIONS = [25, 50, 80, 110]

function DurationCheckboxEditor({ label, values, onChange, hint }: {
  label: string; values: number[]; onChange: (v: number[]) => void; hint?: string
}) {
  const toggle = (n: number) => {
    if (values.includes(n)) {
      // Siempre debe quedar al menos una duración habilitada.
      if (values.length === 1) return
      onChange(values.filter(v => v !== n).sort((a, b) => a - b))
    } else {
      onChange([...values, n].sort((a, b) => a - b))
    }
  }

  return (
    <div>
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">{label}</label>
      {hint && <p className="text-[10px] text-slate-400 mb-2">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {CLASS_DURATION_OPTIONS.map(n => {
          const active = values.includes(n)
          return (
            <button
              key={n}
              type="button"
              onClick={() => toggle(n)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                active
                  ? 'bg-pink-500 border-pink-500 text-white'
                  : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              {n} min
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TrialDurationEditor({ label, value, onChange, hint }: {
  label: string; value: number; onChange: (v: number) => void; hint?: string
}) {
  return (
    <div>
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">{label}</label>
      {hint && <p className="text-[10px] text-slate-400 mb-2">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {CLASS_DURATION_OPTIONS.map(n => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
              value === n
                ? 'bg-amber-400 border-amber-400 text-white'
                : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
            }`}
          >
            {n} min
          </button>
        ))}
      </div>
    </div>
  )
}

function BufferMinutesEditor({ label, value, onChange, hint }: {
  label: string; value: number; onChange: (v: number) => void; hint?: string
}) {
  return (
    <div>
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">{label}</label>
      {hint && <p className="text-[10px] text-slate-400 mb-2">{hint}</p>}
      <input
        type="number"
        min={0}
        max={60}
        value={value}
        onChange={e => onChange(Math.max(0, Math.min(60, parseInt(e.target.value, 10) || 0)))}
        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold"
      />
    </div>
  )
}

const TABS = [
  { key: 'platform', label: 'Plataforma', icon: '🏳️', dot: 'bg-pink-500' },
  { key: 'payments', label: 'Pagos', icon: '💳', dot: 'bg-emerald-400' },
  { key: 'catalogs', label: 'Catálogos', icon: '📚', dot: 'bg-purple-400' },
  { key: 'rules', label: 'Reglas', icon: '⚙️', dot: 'bg-amber-400' },
] as const

type TabKey = typeof TABS[number]['key']

export default function SettingsPage() {
  const { paymentConfig: remotePaymentConfig, loading: pcLoading, isFetching: pcFetching, isError: pcError, refetch: refetchPaymentConfig } = useAdminPaymentConfig()
  const { platformConfig: remotePlatformConfig, loading: plLoading, isFetching: plFetching, isError: plError, refetch: refetchPlatformConfig } = useAdminPlatformConfig()
    const { catalogs, loading: catLoading, isFetching: catFetching, isError: catError, refetch: refetchCatalogs } = useSystemCatalogs()
  const { businessRules: remoteBusinessRules, loading: brLoading, isFetching: brFetching, isError: brError, refetch: refetchBusinessRules } = useAdminBusinessRules()
  
  const [paymentConfig, setPaymentConfig] = useState<AdminPaymentConfig | null>(null)
  const [platformConfig, setPlatformConfig] = useState<AdminPlatformConfig | null>(null)
  const [businessRules, setBusinessRules] = useState<any>(null)
  
  const [paymentDirty, setPaymentDirty] = useState(false)
  const [platformDirty, setPlatformDirty] = useState(false)
  const [rulesDirty, setRulesDirty] = useState(false)
  
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [rulesSaving, setRulesSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('platform')

  // Sincroniza las copias editables con el servidor SOLO si no hay cambios
  // sin guardar — misma salvaguarda que en /admin/users, para no pisar una
  // edición en curso si el admin pide un refresh manual.
  useEffect(() => {
    if (!paymentDirty && remotePaymentConfig) setPaymentConfig(remotePaymentConfig)
  }, [remotePaymentConfig, paymentDirty])

  useEffect(() => {
    if (!platformDirty && remotePlatformConfig) setPlatformConfig(remotePlatformConfig)
  }, [remotePlatformConfig, platformDirty])

  useEffect(() => {
    if (!rulesDirty && remoteBusinessRules) setBusinessRules(remoteBusinessRules)
  }, [remoteBusinessRules, rulesDirty])

  const isFetching = pcFetching || plFetching || catFetching || brFetching

  const handleRefreshAll = () => {
    refetchPaymentConfig()
    refetchPlatformConfig()
    refetchCatalogs()
    refetchBusinessRules()
  }

  usePageTopBar({
    title: 'Configuración Global',
    onRefresh: handleRefreshAll,
    isFetching,
  })

  // Wrappers para marcar "dirty" al primer cambio del admin
  const updatePaymentConfig = (next: AdminPaymentConfig) => {
    setPaymentConfig(next)
    setPaymentDirty(true)
  }

  const updatePlatformConfig = (next: AdminPlatformConfig) => {
    setPlatformConfig(next)
    setPlatformDirty(true)
  }

  const updateBusinessRules = (next: any) => {
    setBusinessRules(next)
    setRulesDirty(true)
  }

  const saveCatalog = async (key: string, value: any) => {
    await api.patch(`/system-catalogs/${key}`, { value })
    await refetchCatalogs()
  }

  const saveBusinessRules = async (patch: any) => {
    setRulesSaving(true)
    try {
      const r = await api.patch('/system-catalogs/business-rules', patch)
      setBusinessRules(r.data)
      setRulesDirty(false)
      // BUG fix: faltaba este refetch (a diferencia de savePaymentConfig /
      // savePlatformConfig, que sí lo hacen). Sin él, el cache de React
      // Query de useAdminBusinessRules quedaba con los datos viejos, y en
      // cuanto rulesDirty pasaba a false el useEffect de sincronización de
      // más arriba pisaba el businessRules recién guardado con ese cache
      // desactualizado — la casilla volvía a marcarse como antes justo
      // después de guardar, aunque el backend sí había guardado el cambio
      // (por eso al refrescar la página manualmente se veía correcto).
      await refetchBusinessRules()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error guardando')
    } finally {
      setRulesSaving(false)
    }
  }

  const savePaymentConfig = async () => {
    if (!paymentConfig) return
    setSaving(true)
    try {
      await api.patch('/payments/config', paymentConfig)
      setPaymentDirty(false)
      await refetchPaymentConfig()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  const savePlatformConfig = async () => {
    setSaving(true)
    try {
      await api.patch('/admin/platform-config', {
        platform_name: platformConfig?.platform_name,
        platform_tagline: platformConfig?.platform_tagline,
        is_single_tenant: platformConfig?.is_single_tenant,
        featured_teacher_username: platformConfig?.featured_teacher_username || null,
      })
      setPlatformDirty(false)
      await refetchPlatformConfig()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  const tabCount = (key: TabKey) => {
    if (key === 'catalogs') {
      return Object.values(catalogs || {}).filter((v: any) => Array.isArray(v) ? v.length : v && Object.keys(v).length).length
    }
    return undefined
  }

  return (
  <>
    <div className="space-y-6 animate-fade-up bg-white min-h-screen p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-100 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold text-slate-800 mb-2 tracking-tight">
            Configuración Global
          </h1>
          <p className="text-sm text-slate-500 font-medium">
            Ajustes generales de la plataforma, cobros y catálogos del sistema.
          </p>
        </div>
        <DesktopOnly>
          <RefreshButton onRefresh={handleRefreshAll} isFetching={isFetching} />
        </DesktopOnly>
      </div>

      {/* ─── Navegación por pestañas ─────────────────────────────────── */}
      <div className="-mx-6 md:-mx-8 px-6 md:px-8 py-2 mb-6 bg-white border-b border-slate-100">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {TABS.map(tab => {
            const active = activeTab === tab.key
            const count = tabCount(tab.key)
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`
                  shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold transition-all
                  ${active
                    ? 'bg-slate-800 text-white shadow-md'
                    : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700'}
                `}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-white' : tab.dot}`} />
                <span>{tab.icon}</span>
                {tab.label}
                {count !== undefined && (
                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${active ? 'bg-white/20' : 'bg-white text-slate-400'}`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">

      {/* ─── Métodos de pago ─────────────────────────────────── */}
      {activeTab === 'payments' && (
        <Card className="p-8 border-slate-100 shadow-sm rounded-3xl space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-1.5 h-6 bg-emerald-400 rounded-full" />
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
              Métodos de Pago (Alumnos)
            </h2>
          </div>
          {pcError ? (
            <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl px-4 py-3.5 flex items-center gap-3 flex-wrap">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span className="text-xs font-bold flex-1">No se pudo cargar la configuración de pagos.</span>
              <button
                onClick={() => refetchPaymentConfig()}
                className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-100 hover:bg-rose-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Reintentar
              </button>
            </div>
          ) : paymentConfig ? (
            <div className="space-y-6">
              {/* PayPal */}
              <div className="bg-slate-50/50 p-6 rounded-2xl border border-slate-100 space-y-4 transition-all hover:border-slate-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🅿️</span>
                    <div>
                      <p className="text-slate-800 text-sm font-bold">PayPal</p>
                      <p className="text-slate-500 text-xs font-medium mt-0.5">
                        Los estudiantes pagan a tu email de PayPal
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => updatePaymentConfig({
                      ...paymentConfig,
                      paypal_enabled: !paymentConfig.paypal_enabled
                    })}
                    className={`
                      relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none
                      ${paymentConfig.paypal_enabled ? 'bg-emerald-500 shadow-inner' : 'bg-slate-200'}
                    `}
                  >
                    <span className={`
                      absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform duration-300 shadow-sm
                      ${paymentConfig.paypal_enabled ? 'translate-x-6' : 'translate-x-0'}
                    `}/>
                  </button>
                </div>
                
                {paymentConfig.paypal_enabled && (
                  <div className="pt-2 animate-in fade-in slide-in-from-top-2">
                    <input
                      type="email"
                      value={paymentConfig.paypal_email || ''}
                      onChange={e => updatePaymentConfig({
                        ...paymentConfig,
                        paypal_email: e.target.value
                      })}
                      placeholder="tu@paypal.com"
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-emerald-50 focus:border-emerald-300 transition-all"
                    />
                  </div>
                )}
              </div>

              {/* Binance */}
              <div className="bg-slate-50/50 p-6 rounded-2xl border border-slate-100 space-y-4 transition-all hover:border-slate-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🔸</span>
                    <div>
                      <p className="text-slate-800 text-sm font-bold">Binance (USDT)</p>
                      <p className="text-slate-500 text-xs font-medium mt-0.5">
                        Transferencias a tu wallet de Binance
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => updatePaymentConfig({
                      ...paymentConfig,
                      binance_enabled: !paymentConfig.binance_enabled
                    })}
                    className={`
                      relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none
                      ${paymentConfig.binance_enabled ? 'bg-emerald-500 shadow-inner' : 'bg-slate-200'}
                    `}
                  >
                    <span className={`
                      absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform duration-300 shadow-sm
                      ${paymentConfig.binance_enabled ? 'translate-x-6' : 'translate-x-0'}
                    `}/>
                  </button>
                </div>

                {paymentConfig.binance_enabled && (
                  <div className="pt-2 grid grid-cols-1 md:grid-cols-2 gap-3 animate-in fade-in slide-in-from-top-2">
                    <input
                      type="text"
                      value={paymentConfig.binance_address || ''}
                      onChange={e => updatePaymentConfig({
                        ...paymentConfig,
                        binance_address: e.target.value
                      })}
                      placeholder="Dirección de wallet"
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-emerald-50 focus:border-emerald-300 transition-all"
                    />
                    <input
                      type="text"
                      value={paymentConfig.binance_network || ''}
                      onChange={e => updatePaymentConfig({
                        ...paymentConfig,
                        binance_network: e.target.value
                      })}
                      placeholder="Red (ej: USDT TRC20)"
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-emerald-50 focus:border-emerald-300 transition-all"
                    />
                  </div>
                )}
              </div>

              {/* Transferencia bancaria */}
              <div className="bg-slate-50/50 p-6 rounded-2xl border border-slate-100 space-y-4 transition-all hover:border-slate-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🏦</span>
                    <div>
                      <p className="text-slate-800 text-sm font-bold">Transferencia bancaria</p>
                      <p className="text-slate-500 text-xs font-medium mt-0.5">
                        Los estudiantes transfieren a tu cuenta bancaria
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => updatePaymentConfig({
                      ...paymentConfig,
                      bank_transfer_enabled: !paymentConfig.bank_transfer_enabled
                    })}
                    className={`
                      relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none
                      ${paymentConfig.bank_transfer_enabled ? 'bg-emerald-500 shadow-inner' : 'bg-slate-200'}
                    `}
                  >
                    <span className={`
                      absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform duration-300 shadow-sm
                      ${paymentConfig.bank_transfer_enabled ? 'translate-x-6' : 'translate-x-0'}
                    `}/>
                  </button>
                </div>

                {paymentConfig.bank_transfer_enabled && (
                  <div className="pt-2 animate-in fade-in slide-in-from-top-2">
                    <textarea
                      value={paymentConfig.bank_transfer_details || ''}
                      onChange={e => updatePaymentConfig({
                        ...paymentConfig,
                        bank_transfer_details: e.target.value
                      })}
                      rows={3}
                      placeholder="Banco, titular de la cuenta, número de cuenta, IBAN/SWIFT si aplica..."
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-emerald-50 focus:border-emerald-300 transition-all resize-none"
                    />
                  </div>
                )}
              </div>

              {/* Pago móvil / Bizum */}
              <div className="bg-slate-50/50 p-6 rounded-2xl border border-slate-100 space-y-4 transition-all hover:border-slate-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">📱</span>
                    <div>
                      <p className="text-slate-800 text-sm font-bold">Pago móvil / Bizum</p>
                      <p className="text-slate-500 text-xs font-medium mt-0.5">
                        Pago instantáneo desde el móvil (Pago Móvil, Bizum, etc.)
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => updatePaymentConfig({
                      ...paymentConfig,
                      mobile_payment_enabled: !paymentConfig.mobile_payment_enabled
                    })}
                    className={`
                      relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none
                      ${paymentConfig.mobile_payment_enabled ? 'bg-emerald-500 shadow-inner' : 'bg-slate-200'}
                    `}
                  >
                    <span className={`
                      absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform duration-300 shadow-sm
                      ${paymentConfig.mobile_payment_enabled ? 'translate-x-6' : 'translate-x-0'}
                    `}/>
                  </button>
                </div>

                {paymentConfig.mobile_payment_enabled && (
                  <div className="pt-2 animate-in fade-in slide-in-from-top-2">
                    <textarea
                      value={paymentConfig.mobile_payment_details || ''}
                      onChange={e => updatePaymentConfig({
                        ...paymentConfig,
                        mobile_payment_details: e.target.value
                      })}
                      rows={2}
                      placeholder="Ej: Teléfono, cédula/DNI y banco (Pago Móvil) o número de Bizum..."
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-emerald-50 focus:border-emerald-300 transition-all resize-none"
                    />
                  </div>
                )}
              </div>

              {/* WhatsApp fallback */}
              <div className="bg-slate-50/50 p-6 rounded-2xl border border-slate-100 space-y-4 transition-all hover:border-slate-200">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">💬</span>
                  <div>
                    <p className="text-slate-800 text-sm font-bold">WhatsApp (Fallback)</p>
                    <p className="text-slate-500 text-xs font-medium mt-0.5">
                      Número alternativo si no hay métodos automáticos
                    </p>
                  </div>
                </div>
                <input
                  type="text"
                  value={paymentConfig.whatsapp_number || ''}
                  onChange={e => updatePaymentConfig({
                    ...paymentConfig,
                    whatsapp_number: e.target.value
                  })}
                  placeholder="+58 412 0000000"
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-pink-50 focus:border-pink-300 transition-all"
                />
              </div>

              {/* Comisión por defecto */}
              <div className="bg-slate-50/50 p-6 rounded-2xl border border-slate-100 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">💰</span>
                  <div>
                    <p className="text-slate-800 text-sm font-bold">Comisión por defecto</p>
                    <p className="text-slate-500 text-xs font-medium mt-0.5">
                      Se aplica a profesores nuevos. Puedes personalizarla por profesor desde "Profesores".
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 max-w-xs">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={paymentConfig.default_commission_rate}
                    onChange={e => updatePaymentConfig({
                      ...paymentConfig,
                      default_commission_rate: parseFloat(e.target.value) || 0
                    })}
                    className="w-24 bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-pink-50 focus:border-pink-300 transition-all"
                  />
                  <span className="text-sm font-bold text-slate-500">
                    = {(paymentConfig.default_commission_rate * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              <div className="pt-4 flex justify-end">
                <Button
                  variant="primary"
                  loading={saving}
                  onClick={savePaymentConfig}
                  className="md:w-auto w-full px-8 py-3 !rounded-2xl shadow-md shadow-pink-200"
                >
                  {saved ? '✓ Guardado exitosamente' : 'Guardar métodos de pago'}
                </Button>
              </div>
            </div>
          ) : (
            <Skeleton className="h-32 w-full rounded-2xl" />
          )}
        </Card>
      )}

      {/* ─── Configuración de plataforma ─────────────────────────────────── */}
      {activeTab === 'platform' && (
        <Card className="p-8 border-slate-100 shadow-sm rounded-3xl space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-1.5 h-6 bg-pink-500 rounded-full" />
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
              Identidad de Plataforma
            </h2>
          </div>

          {plError ? (
            <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl px-4 py-3.5 flex items-center gap-3 flex-wrap">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span className="text-xs font-bold flex-1">No se pudo cargar la configuración de plataforma.</span>
              <button
                onClick={() => refetchPlatformConfig()}
                className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-100 hover:bg-rose-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Reintentar
              </button>
            </div>
          ) : platformConfig ? (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Nombre de la plataforma
                  </label>
                  <input
                    type="text"
                    value={platformConfig.platform_name}
                    onChange={e => updatePlatformConfig({
                      ...platformConfig,
                      platform_name: e.target.value
                    })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-pink-50 focus:border-pink-300 transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Tagline (Eslogan)
                  </label>
                  <input
                    type="text"
                    value={platformConfig.platform_tagline || ''}
                    onChange={e => updatePlatformConfig({
                      ...platformConfig,
                      platform_tagline: e.target.value
                    })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-pink-50 focus:border-pink-300 transition-all"
                  />
                </div>
              </div>

              {/* Single-tenant toggle */}
              <div className="flex items-center justify-between bg-pink-50/50 rounded-2xl p-6 border border-pink-100">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-slate-800 text-sm font-bold">
                      Modo Single-tenant
                    </p>
                    <span className="bg-pink-100 text-pink-600 text-[10px] font-black uppercase px-2 py-0.5 rounded-md">Pro</span>
                  </div>
                  <p className="text-slate-500 text-xs font-medium mt-1">
                    {platformConfig.is_single_tenant
                      ? 'Flujo directo: los alumnos son asignados al profesor destacado.'
                      : 'Marketplace: los estudiantes eligen a su propio profesor.'
                    }
                  </p>
                  {platformConfig.featured_teacher && (
                    <p className="text-pink-600 text-xs font-bold mt-2 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse" />
                      Profesora activa: {platformConfig.featured_teacher.name}
                    </p>
                  )}
                </div>
                
                <button
                  onClick={() => updatePlatformConfig({
                    ...platformConfig,
                    is_single_tenant: !platformConfig.is_single_tenant
                  })}
                  className={`
                    relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none shrink-0 ml-4
                    ${platformConfig.is_single_tenant ? 'bg-pink-500 shadow-inner' : 'bg-slate-200'}
                  `}
                >
                  <span className={`
                    absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform duration-300 shadow-sm
                    ${platformConfig.is_single_tenant ? 'translate-x-6' : 'translate-x-0'}
                  `}/>
                </button>
              </div>

              {platformConfig.is_single_tenant && (
                <div className="space-y-2 pt-2 animate-in fade-in slide-in-from-top-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Username del Profesor Destacado
                  </label>
                  <input
                    type="text"
                    value={platformConfig.featured_teacher_username || ''}
                    onChange={e => updatePlatformConfig({
                      ...platformConfig,
                      featured_teacher_username: e.target.value
                    })}
                    placeholder="Ejemplo: mar12"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-pink-50 focus:border-pink-300 transition-all"
                  />
                  <p className="text-xs text-slate-500 font-medium ml-1 mt-1">
                    Ingresa el nombre de usuario exacto del profesor. Si el usuario no existe, arrojará un error.
                  </p>
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <Button
                  variant="primary"
                  loading={saving}
                  onClick={savePlatformConfig}
                  className="md:w-auto w-full px-8 py-3 !rounded-2xl shadow-md shadow-pink-200"
                >
                  {saved ? '✓ Configuración guardada' : 'Guardar plataforma'}
                </Button>
              </div>
            </div>
          ) : (
            <Skeleton className="h-32 w-full rounded-2xl" />
          )}
        </Card>
      )}

      {/* ─── Catálogos del Sistema ─────────────────────────────────── */}
      {activeTab === 'catalogs' && (
        catError ? (
          <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl px-4 py-3.5 flex items-center gap-3 flex-wrap">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="text-xs font-bold flex-1">No se pudieron cargar los catálogos del sistema.</span>
            <button
              onClick={() => refetchCatalogs()}
              className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-100 hover:bg-rose-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reintentar
            </button>
          </div>
        ) : catLoading ? (
          <div className="space-y-8">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-64 w-full rounded-3xl" />)}
          </div>
        ) : (
          <div className="space-y-8">
            <Card className="p-8 border-slate-100 shadow-sm rounded-3xl space-y-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-1.5 h-6 bg-purple-400 rounded-full" />
                <div>
                  <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    Catálogos básicos
                  </h2>
                  <p className="text-[11px] text-slate-400 font-medium mt-0.5">Listas de opciones usadas en formularios de perfil, materiales y paquetes.</p>
                </div>
              </div>

              <CatalogEditor catalogKey="subjects" label="Materias" items={catalogs.subjects ?? []}
                onSave={v => saveCatalog('subjects', v)} />
              <CatalogEditor catalogKey="languages" label="Idiomas" items={catalogs.languages ?? []}
                onSave={v => saveCatalog('languages', v)} />
              <CatalogEditor catalogKey="skill_suggestions" label="Habilidades sugeridas" items={catalogs.skill_suggestions ?? []}
                onSave={v => saveCatalog('skill_suggestions', v)} />
              <CatalogEditor catalogKey="material_categories" label="Categorías de materiales" items={catalogs.material_categories ?? []}
                onSave={v => saveCatalog('material_categories', v)} />
              <CatalogEditor catalogKey="material_levels" label="Niveles de materiales" items={catalogs.material_levels ?? []}
                onSave={v => saveCatalog('material_levels', v)} />
              <CatalogEditor catalogKey="package_icon_options" label="Iconos de paquetes" items={catalogs.package_icon_options ?? []}
                onSave={v => saveCatalog('package_icon_options', v)} />
            </Card>

            <Card className="p-8 border-slate-100 shadow-sm rounded-3xl space-y-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-1.5 h-6 bg-purple-400 rounded-full" />
                <div>
                  <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    Objetivos y métodos de cobro
                  </h2>
                  <p className="text-[11px] text-slate-400 font-medium mt-0.5">Objetivos que eligen los estudiantes y formas de pago/retiro disponibles.</p>
                </div>
              </div>

              <GoalsEditor items={catalogs.student_goals ?? {}} onSave={v => saveCatalog('student_goals', v)} />
              <PaymentMethodsEditor title="Métodos de pago (estudiante)" items={catalogs.student_payment_methods ?? []} onSave={v => saveCatalog('student_payment_methods', v)} />
              <PaymentMethodsEditor title="Métodos de retiro (profesor)" items={catalogs.withdrawal_methods ?? []} onSave={v => saveCatalog('withdrawal_methods', v)} />
            </Card>

            <Card className="p-8 border-slate-100 shadow-sm rounded-3xl space-y-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-1.5 h-6 bg-purple-400 rounded-full" />
                <div>
                  <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    Apariencia
                  </h2>
                  <p className="text-[11px] text-slate-400 font-medium mt-0.5">Colores y temas visuales usados en paquetes, materias e idiomas.</p>
                </div>
              </div>

              <ThemePresetsEditor items={catalogs.theme_presets ?? []} onSave={v => saveCatalog('theme_presets', v)} />
              <SubjectThemeMapEditor subjects={catalogs.subjects ?? []} languages={catalogs.languages ?? []} map={catalogs.subject_theme_map ?? {}} onSave={v => saveCatalog('subject_theme_map', v)} />
            </Card>
          </div>
        )
      )}

      {/* ─── Reglas de negocio ─────────────────────────────────────── */}
      {activeTab === 'rules' && brError && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl px-4 py-3.5 flex items-center gap-3 flex-wrap">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="text-xs font-bold flex-1">No se pudieron cargar las reglas de negocio.</span>
          <button
            onClick={() => refetchBusinessRules()}
            className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-100 hover:bg-rose-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Reintentar
          </button>
        </div>
      )}

      {activeTab === 'rules' && businessRules && !brError && (
        <Card className="p-8 border-slate-100 shadow-sm rounded-3xl space-y-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-1.5 h-6 bg-amber-400 rounded-full" />
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
              Reglas de negocio
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { key: 'min_booking_hours', label: 'Horas mínimas para agendar' },
              { key: 'min_cancel_hours', label: 'Horas mínimas para cancelar sin penalización' },
              { key: 'min_reschedule_hours_student', label: 'Horas mínimas para reagendar (estudiante)' },
              { key: 'low_credit_threshold', label: 'Umbral de crédito bajo' },
              { key: 'low_credit_renotify_days', label: 'Días entre avisos de crédito bajo' },
            ].map(f => (
              <div key={f.key}>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">{f.label}</label>
                <input type="number" value={businessRules[f.key]}
                  onChange={e => updateBusinessRules({ ...businessRules, [f.key]: parseInt(e.target.value) || 0 })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold" />
              </div>
            ))}
            <DurationCheckboxEditor
              label="Duraciones permitidas para clases regulares"
              values={businessRules.allowed_class_durations ?? []}
              onChange={v => updateBusinessRules({ ...businessRules, allowed_class_durations: v })}
            />
            <DurationCheckboxEditor
              label="Duraciones permitidas para paquetes"
              values={businessRules.allowed_package_durations ?? []}
              onChange={v => updateBusinessRules({ ...businessRules, allowed_package_durations: v })}
            />
          </div>

          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center gap-3 mb-4 mt-2">
              <div className="w-1.5 h-6 bg-amber-400 rounded-full" />
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                Clase de prueba
              </h3>
            </div>
            <TrialDurationEditor
              label="Duración de la clase de prueba"
              value={businessRules.trial_duration_minutes ?? 25}
              onChange={v => updateBusinessRules({ ...businessRules, trial_duration_minutes: v })}
              hint="Duración real de la clase de prueba. Es un único valor, no una lista — hoy 25 min, editable acá si cambia en el futuro."
            />
          </div>

          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center gap-3 mb-4 mt-2">
              <div className="w-1.5 h-6 bg-amber-400 rounded-full" />
              <div>
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                  Márgenes de preparación
                </h3>
                <p className="text-[11px] text-slate-400 font-medium mt-0.5">
                  Minutos que se descuentan del final real de la clase para dejarle tiempo al
                  profesor de prepararse para la siguiente (ej. una clase de 50 min con 10 min de
                  margen termina a los 50 min, pero bloquea la agenda del profesor por 60 min).
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <BufferMinutesEditor
                label="Margen — clase de prueba"
                value={businessRules.buffer_trial_minutes ?? 5}
                onChange={v => updateBusinessRules({ ...businessRules, buffer_trial_minutes: v })}
              />
              <BufferMinutesEditor
                label="Margen — clase regular"
                value={businessRules.buffer_regular_minutes ?? 10}
                onChange={v => updateBusinessRules({ ...businessRules, buffer_regular_minutes: v })}
              />
              <BufferMinutesEditor
                label="Margen — clase grupal"
                value={businessRules.buffer_group_minutes ?? 10}
                onChange={v => updateBusinessRules({ ...businessRules, buffer_group_minutes: v })}
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center gap-3 mb-4 mt-2">
              <div className="w-1.5 h-6 bg-amber-400 rounded-full" />
              <div>
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                  Videollamada
                </h3>
                <p className="text-[11px] text-slate-400 font-medium mt-0.5">
                  Si el profesor no cargó un link manualmente, el sistema genera uno automático
                  (Google Meet) esta cantidad de minutos antes del inicio de la clase.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                  Minutos antes de la clase
                </label>
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={businessRules.meet_link_autogen_minutes ?? 30}
                  onChange={e => updateBusinessRules({
                    ...businessRules,
                    meet_link_autogen_minutes: Math.max(5, Math.min(180, parseInt(e.target.value, 10) || 30)),
                  })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold"
                />
              </div>
            </div>
          </div>
          <Button
            variant="primary"
            loading={rulesSaving}
            onClick={() => saveBusinessRules(businessRules)}
            className="!w-auto px-6 py-2.5 !rounded-xl text-sm"
          >
            Guardar reglas
          </Button>
        </Card>
      )}

      {activeTab === 'rules' && !businessRules && !brError && (
        <Skeleton className="h-40 w-full rounded-2xl" />
      )}

      </div>

    </div>
    <ChipiWidget screenName="admin_settings" /> 
  </>
  )
}