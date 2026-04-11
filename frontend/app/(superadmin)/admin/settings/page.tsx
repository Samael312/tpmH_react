'use client'

import { useState, useEffect } from 'react'
import { Card, Button } from '@/components/ui'
import api from '@/lib/api'

interface PaymentConfig {
  paypal_enabled: boolean
  binance_enabled: boolean
  paypal_email: string | null
  binance_address: string | null
  binance_network: string | null
  whatsapp_number: string | null
}

interface PlatformConfig {
  platform_name: string
  platform_tagline: string | null
  is_single_tenant: boolean
  featured_teacher: any
}

export default function SettingsPage() {
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null)
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.get('/payments/config').then(r => setPaymentConfig(r.data))
    api.get('/admin/platform-config').then(r => setPlatformConfig(r.data))
  }, [])

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
      </div>
    </div>
  )
}