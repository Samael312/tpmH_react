'use client'

import { useState, useEffect } from 'react'
import { Card, Button } from '@/components/ui'
import api from '@/lib/api'
import ChipiWidget from '@/components/chipi/ChipiWidget'

interface PaymentConfig {
  paypal_enabled: boolean
  binance_enabled: boolean
  bank_transfer_enabled: boolean
  mobile_payment_enabled: boolean
  paypal_email: string | null
  binance_address: string | null
  binance_network: string | null
  bank_transfer_details: string | null
  mobile_payment_details: string | null
  whatsapp_number: string | null
  default_commission_rate: number
}

interface PlatformConfig {
  platform_name: string
  platform_tagline: string | null
  is_single_tenant: boolean
  featured_teacher: any
  featured_teacher_username?: string
}

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

function GoalsEditor({ items, onSave }: { items: any[]; onSave: (v: any[]) => Promise<void> }) {
  const [list, setList] = useState(items)
  const [saving, setSaving] = useState(false)

  useEffect(() => setList(items), [items])

  const update = (i: number, field: string, value: string) => {
    const next = [...list]; next[i] = { ...next[i], [field]: value }; setList(next)
  }
  const remove = (i: number) => setList(list.filter((_, idx) => idx !== i))
  const add = () => setList([...list, { text: '', desc: '', icon: '🎯' }])
  const save = async () => { setSaving(true); try { await onSave(list) } finally { setSaving(false) } }

  return (
    <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-3">
      <p className="text-xs font-black text-slate-700">Objetivos de aprendizaje</p>
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

function DurationListEditor({ label, values, onChange }: {
  label: string; values: number[]; onChange: (v: number[]) => void
}) {
  const [input, setInput] = useState('')

  const add = () => {
    const n = parseInt(input, 10)
    if (!isNaN(n) && n > 0 && !values.includes(n)) {
      onChange([...values, n].sort((a, b) => a - b))
    }
    setInput('')
  }
  const remove = (n: number) => onChange(values.filter(v => v !== n))

  return (
    <div>
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">{label}</label>
      <div className="flex flex-wrap gap-2 mb-2">
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-xs font-bold text-slate-700 px-3 py-1.5 rounded-xl">
            {v} min
            <button onClick={() => remove(v)} className="text-slate-300 hover:text-rose-400">✕</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input type="number" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="Ej: 45" className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        <button onClick={add} className="px-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-bold">+</button>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null)
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // NUEVO: Estados para catálogos y reglas de negocio
  const [catalogs, setCatalogs] = useState<Record<string, any>>({})
  const [businessRules, setBusinessRules] = useState<any>(null)

  useEffect(() => {
    api.get('/payments/config').then(r => setPaymentConfig(r.data))
    
    api.get('/admin/platform-config').then(r => {
      setPlatformConfig({
        ...r.data,
        featured_teacher_username: r.data.featured_teacher?.username || ''
      })
    })

    // NUEVO: Carga de catálogos y reglas del sistema
    api.get('/system-catalogs/').then(r => setCatalogs(r.data))
    api.get('/system-catalogs/business-rules').then(r => setBusinessRules(r.data))
  }, [])

  // NUEVO: Funciones de guardado para catálogos y reglas de negocio
  const saveCatalog = async (key: string, value: any) => {
    await api.patch(`/system-catalogs/${key}`, { value })
    const r = await api.get('/system-catalogs/')
    setCatalogs(r.data)
  }

  const saveBusinessRules = async (patch: any) => {
    const r = await api.patch('/system-catalogs/business-rules', patch)
    setBusinessRules(r.data)
  }

  const savePaymentConfig = async () => {
    setSaving(true)
    try {
      await api.patch('/payments/config', paymentConfig)
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
      
      const r = await api.get('/admin/platform-config')
      setPlatformConfig({
        ...r.data,
        featured_teacher_username: r.data.featured_teacher?.username || ''
      })
      
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  return (
  <>
    <div className="space-y-8 animate-fade-up bg-white min-h-screen p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-100 max-w-4xl mx-auto">

      {/* Header */}
      <div>
        <h1 className="font-display text-4xl font-bold text-slate-800 mb-2 tracking-tight">
          Configuración Global
        </h1>
        <p className="text-sm text-slate-500 font-medium">
          Ajustes generales de la plataforma y métodos de cobro a estudiantes.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8">
        
      {/* ─── Métodos de pago ─────────────────────────────────── */}
        <Card className="p-8 border-slate-100 shadow-sm rounded-3xl space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-1.5 h-6 bg-emerald-400 rounded-full" />
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
              Métodos de Pago (Alumnos)
            </h2>
          </div>

          {paymentConfig ? (
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
                    onClick={() => setPaymentConfig({
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
                      onChange={e => setPaymentConfig({
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
                    onClick={() => setPaymentConfig({
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
                      onChange={e => setPaymentConfig({
                        ...paymentConfig,
                        binance_address: e.target.value
                      })}
                      placeholder="Dirección de wallet"
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-emerald-50 focus:border-emerald-300 transition-all"
                    />
                    <input
                      type="text"
                      value={paymentConfig.binance_network || ''}
                      onChange={e => setPaymentConfig({
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
                    onClick={() => setPaymentConfig({
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
                      onChange={e => setPaymentConfig({
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
                    onClick={() => setPaymentConfig({
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
                      onChange={e => setPaymentConfig({
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
                  onChange={e => setPaymentConfig({
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
                    onChange={e => setPaymentConfig({
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
            <div className="h-40 bg-slate-50 rounded-2xl animate-pulse border border-slate-100" />
          )}
        </Card>
        
        {/* ─── Configuración de plataforma ─────────────────────────────────── */}
        <Card className="p-8 border-slate-100 shadow-sm rounded-3xl space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-1.5 h-6 bg-pink-500 rounded-full" />
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
              Identidad de Plataforma
            </h2>
          </div>

          {platformConfig ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Nombre de la plataforma
                  </label>
                  <input
                    type="text"
                    value={platformConfig.platform_name}
                    onChange={e => setPlatformConfig({
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
                    onChange={e => setPlatformConfig({
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
                  onClick={() => setPlatformConfig({
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
                    onChange={e => setPlatformConfig({
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
            <div className="h-32 bg-slate-50 rounded-2xl animate-pulse border border-slate-100" />
          )}
        </Card>

        {/* ─── NUEVO: Catálogos del Sistema ─────────────────────────────────── */}
        <Card className="p-8 border-slate-100 shadow-sm rounded-3xl space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-1.5 h-6 bg-purple-400 rounded-full" />
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
              Catálogos del Sistema
            </h2>
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

          <GoalsEditor items={catalogs.student_goals ?? []} onSave={v => saveCatalog('student_goals', v)} />
          <PaymentMethodsEditor title="Métodos de pago (estudiante)" items={catalogs.student_payment_methods ?? []} onSave={v => saveCatalog('student_payment_methods', v)} />
          <PaymentMethodsEditor title="Métodos de retiro (profesor)" items={catalogs.withdrawal_methods ?? []} onSave={v => saveCatalog('withdrawal_methods', v)} />
          <ThemePresetsEditor items={catalogs.theme_presets ?? []} onSave={v => saveCatalog('theme_presets', v)} />
          <SubjectThemeMapEditor subjects={catalogs.subjects ?? []} languages={catalogs.languages ?? []} map={catalogs.subject_theme_map ?? {}} onSave={v => saveCatalog('subject_theme_map', v)} />
        </Card>

        {/* ─── NUEVO: Reglas de negocio ─────────────────────────────────────── */}
        {businessRules && (
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
                    onChange={e => setBusinessRules({ ...businessRules, [f.key]: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold" />
                </div>
              ))}
              <DurationListEditor
                label="Duraciones permitidas para clases"
                values={businessRules.allowed_class_durations ?? []}
                onChange={v => setBusinessRules({ ...businessRules, allowed_class_durations: v })}
              />
              <DurationListEditor
                label="Duraciones permitidas para paquetes"
                values={businessRules.allowed_package_durations ?? []}
                onChange={v => setBusinessRules({ ...businessRules, allowed_package_durations: v })}
              />
            </div>
            <button onClick={() => saveBusinessRules(businessRules)}
              className="px-6 py-2.5 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-sm font-bold">
              Guardar reglas
            </button>
          </Card>
        )}

      </div>
      
    </div>
    <ChipiWidget screenName="admin_settings" /> 
    </>
  )
}