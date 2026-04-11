'use client'

import { useState } from 'react'
import { useWallet } from '@/hooks/useTeacherData'
import { Card, Button, Badge, StatCard } from '@/components/ui'
import api from '@/lib/api'

const DESTINATION_METHODS = [
  { value: 'paypal',  label: 'PayPal', icon: '🅿️' },
  { value: 'binance', label: 'Binance (USDT)', icon: '🔸' },
  { value: 'bank',    label: 'Transferencia', icon: '🏦' },
]

export default function WalletPage() {
  const { wallet, loading, refetch } = useWallet()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('paypal')
  const [details, setDetails] = useState('')
  const [requesting, setRequesting] = useState(false)
  const [success, setSuccess] = useState(false)

  const requestWithdrawal = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt < 10) {
      alert('El monto mínimo es $10')
      return
    }
    if (!details.trim()) {
      alert('Introduce los datos de destino')
      return
    }
    setRequesting(true)
    try {
      await api.post('/payments/request-withdrawal', {
        amount: amt,
        destination_method: method,
        destination_details: details,
      })
      setSuccess(true)
      setAmount('')
      setDetails('')
      refetch()
      setTimeout(() => setSuccess(false), 5000)
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error solicitando retiro')
    } finally {
      setRequesting(false)
    }
  }

  return (
    <div className="space-y-8 animate-fade-up max-w-4xl mx-auto pb-12">
      
      {/* Header */}
      <div>
        <h1 className="font-display text-4xl font-black text-slate-800 mb-2 tracking-tight">
          Mis Ganancias
        </h1>
        <p className="text-slate-500 font-medium">
          Gestiona tus ingresos acumulados y solicita tus pagos de forma segura.
        </p>
      </div>

      {/* Stats Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {loading ? (
          [1, 2, 3].map(i => (
            <div key={i} className="h-32 bg-white rounded-[2rem] animate-pulse border border-slate-100 shadow-sm" />
          ))
        ) : wallet && (
          <>
            <StatCard 
              label="Disponible" 
              value={`$${wallet.available_balance.toFixed(2)}`}
              change="Listo para retirar"
              changeType="up"
              icon={<WalletIcon />}
            />
            <StatCard 
              label="Total Ganado" 
              value={`$${wallet.total_earned.toFixed(2)}`}
              change="Histórico total"
              changeType="neutral"
              icon={<TrendingUpIcon />}
            />
            <StatCard 
              label="Total Retirado" 
              value={`$${wallet.total_withdrawn.toFixed(2)}`}
              change="Procesado"
              changeType="neutral"
              icon={<CheckIcon />}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-1 gap-8">
        {/* Formulario de Retiro */}
        <Card className="p-8 md:p-10 relative overflow-hidden">
          {/* Decoración de fondo */}
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-pink-50 rounded-full blur-3xl opacity-50" />
          
          <div className="relative z-10 space-y-8">
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-6 bg-emerald-500 rounded-full" />
              <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest">
                Solicitar nuevo retiro
              </h2>
            </div>

            {success && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-6 py-4 flex items-center gap-4 animate-in zoom-in duration-300">
                <div className="bg-emerald-500 text-white rounded-full p-1">
                  <CheckIcon className="w-4 h-4" />
                </div>
                <p className="text-emerald-700 font-bold text-sm">
                  ¡Solicitud enviada con éxito! La procesaremos en 1-3 días hábiles.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div className="space-y-6">
                {/* Monto */}
                <div className="space-y-3">
                  <label className="text-xs font-black text-slate-500 uppercase ml-1 tracking-tight">Monto a retirar</label>
                  <div className="relative group">
                    <span className="absolute left-5 top-1/2 -translate-y-1/2 text-2xl font-black text-slate-300 group-focus-within:text-pink-500 transition-colors">$</span>
                    <input
                      type="number"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-slate-50 border border-slate-200 rounded-[1.5rem] pl-12 pr-6 py-5 text-2xl font-black text-slate-800 outline-none focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all"
                    />
                  </div>
                  {wallet && (
                    <button
                      onClick={() => setAmount(wallet.available_balance.toString())}
                      className="text-xs font-bold text-pink-500 hover:text-pink-600 ml-1 transition-colors flex items-center gap-1"
                    >
                      <span className="underline underline-offset-4">Retirar saldo máximo</span> 
                      <Badge variant="pink" className="ml-2">${wallet.available_balance.toFixed(2)}</Badge>
                    </button>
                  )}
                </div>

                {/* Método Selector */}
                <div className="space-y-3">
                  <label className="text-xs font-black text-slate-500 uppercase ml-1 tracking-tight">Método de pago</label>
                  <div className="grid grid-cols-1 gap-2">
                    {DESTINATION_METHODS.map(m => (
                      <button
                        key={m.value}
                        onClick={() => setMethod(m.value)}
                        className={`
                          flex items-center justify-between px-6 py-4 rounded-2xl border font-bold text-sm transition-all
                          ${method === m.value 
                            ? 'bg-pink-500 border-pink-500 text-white shadow-lg shadow-pink-200 scale-[1.02]' 
                            : 'bg-white border-slate-100 text-slate-600 hover:border-pink-200'
                          }
                        `}
                      >
                        <span className="flex items-center gap-3">
                          <span className="text-xl">{m.icon}</span>
                          {m.label}
                        </span>
                        {method === m.value && <div className="w-2 h-2 bg-white rounded-full animate-pulse" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-6 flex flex-col justify-between">
                {/* Datos de destino */}
                <div className="space-y-3">
                  <label className="text-xs font-black text-slate-500 uppercase ml-1 tracking-tight">
                    {method === 'paypal'  && 'Email de cuenta PayPal'}
                    {method === 'binance' && 'Dirección de Wallet (Red TRC-20)'}
                    {method === 'bank'    && 'Detalles Bancarios Completos'}
                  </label>
                  <textarea
                    rows={4}
                    value={details}
                    onChange={e => setDetails(e.target.value)}
                    placeholder={
                      method === 'paypal' ? 'ejemplo@correo.com' : 
                      method === 'binance' ? 'Txxxx...' : 
                      'Banco:\nCuenta:\nTitular:\nSwift/IBAN:'
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-[1.5rem] px-6 py-4 text-sm font-bold text-slate-700 outline-none focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all placeholder:text-slate-300"
                  />
                </div>

                <div className="space-y-4">
                  <Button
                    variant="primary"
                    size="lg"
                    loading={requesting}
                    onClick={requestWithdrawal}
                    className="w-full py-6 !rounded-[1.5rem]"
                  >
                    Confirmar Retiro
                  </Button>
                  <p className="text-[10px] text-slate-400 text-center uppercase font-black tracking-widest leading-relaxed">
                    Pagos procesados por el departamento financiero <br/> de lunes a viernes
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

// Iconos
const WalletIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
  </svg>
)

const TrendingUpIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
  </svg>
)

const CheckIcon = ({ className = "w-6 h-6" }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
)