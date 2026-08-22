'use client'

import { useState } from 'react'
import { useWallet, useMyWithdrawals, useMyIncome } from '@/hooks/useTeacherData'
import { Card, Badge, RefreshButton, Skeleton } from '@/components/ui'
import api from '@/lib/api'
import ChipiWidget from '@/components/chipi/ChipiWidget'
import { Wallet as WalletIcon, TrendingUp, CheckCircle2, X, Loader2, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
// in teacher onboarding StepSpecialties, teacher/profile, teacher/packages, etc.
import { useSystemCatalogs } from "@/hooks/useSystemCatalogs";
import { SUBJECTS as FALLBACK_SUBJECTS, LANGUAGES as FALLBACK_LANGUAGES, SKILL_SUGGESTIONS as FALLBACK_SKILLS } from "@/lib/teacherOptions";



const STATUS_BADGE: Record<string, 'warning' | 'success' | 'danger' | 'info'> = {
  pending: 'warning',
  completed: 'success',
  rejected: 'danger',
  approved: 'success',
  pending_review: 'warning',
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'En revisión',
  completed: 'Transferido',
  rejected: 'Rechazado',
  approved: 'Acreditado',
  pending_review: 'En revisión',
}

const DESTINATION_METHODS = [
  { value: 'paypal', label: 'PayPal', icon: '🅿️' },
  { value: 'binance', label: 'Binance (USDT)', icon: '🔸' },
  { value: 'bank', label: 'Transferencia', icon: '🏦' },
]

function RequestWithdrawalModal({
  available,
  onClose,
  onDone,
}: {
  available: number
  onClose: () => void
  onDone: () => void
}) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('paypal')
  const [paymentInfo, setPaymentInfo] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const amountNum = parseFloat(amount)
  const valid = amountNum >= 10 && amountNum <= available && paymentInfo.trim().length > 0

  const submit = async () => {
    if (!valid) return
    setSending(true)
    setError('')
    try {
      await api.post('/payments/request-withdrawal', {
        amount: amountNum,
        destination_method: method,
        payment_info: paymentInfo.trim(),
      })
      onDone()
      onClose()
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Error solicitando el retiro')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onClick={onClose} />
      
      <div className="relative w-full max-w-lg bg-white rounded-[2rem] shadow-2xl p-6 sm:p-8 space-y-6 animate-in zoom-in-95 duration-200 z-10 my-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-6 bg-pink-500 rounded-full" />
            <h2 className="text-lg font-black text-slate-800">Solicitar retiro</h2>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 transition-all flex items-center justify-center"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Balance Display */}
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Saldo disponible</p>
            <p className="text-2xl sm:text-3xl font-black text-emerald-700">${available.toFixed(2)}</p>
          </div>
          <button
            type="button"
            onClick={() => setAmount(available.toString())}
            className="text-xs font-bold text-emerald-700 underline underline-offset-2 hover:text-emerald-800 transition-colors"
          >
            Usar máximo
          </button>
        </div>

        {/* Monto */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Monto a retirar</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-black text-slate-300">$</span>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-slate-50 border-2 border-transparent rounded-2xl pl-9 pr-4 py-3.5 text-lg font-black text-slate-800 outline-none focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-50 transition-all"
            />
          </div>
          {amountNum > available && <p className="text-[11px] text-rose-500 font-bold">Excede tu saldo disponible</p>}
          {amountNum > 0 && amountNum < 10 && <p className="text-[11px] text-rose-500 font-bold">El monto mínimo de retiro es $10.00</p>}
        </div>

        {/* Método Selector */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Método de pago</label>
          <div className="grid grid-cols-3 gap-2">
            {DESTINATION_METHODS.map(m => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMethod(m.value)}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-bold transition-all ${
                  method === m.value
                    ? 'bg-pink-50 border-pink-500 text-pink-700 shadow-sm'
                    : 'bg-slate-50 border-slate-100 text-slate-600 hover:border-slate-200'
                }`}
              >
                <span className="text-lg mb-1">{m.icon}</span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Datos de destino */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
            {method === 'paypal' && 'Email de PayPal'}
            {method === 'binance' && 'Dirección de Wallet (USDT TRC-20)'}
            {method === 'bank' && 'Datos Bancarios completos (IBAN / SWIFT)'}
          </label>
          <textarea
            rows={3}
            value={paymentInfo}
            onChange={e => setPaymentInfo(e.target.value)}
            placeholder={
              method === 'paypal' ? 'ejemplo@correo.com' :
              method === 'binance' ? 'Txxxx...' :
              'Banco, Titular, Número de cuenta...'
            }
            className="w-full bg-slate-50 border-2 border-transparent rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-50 transition-all resize-none placeholder:text-slate-300"
          />
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-2xl text-xs font-bold animate-in fade-in">
            {error}
          </div>
        )}

        <button
          onClick={submit}
          disabled={!valid || sending}
          className="w-full py-4 text-sm font-bold text-white rounded-2xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
        >
          {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Confirmar solicitud'}
        </button>
      </div>
    </div>
  )
}

export default function WalletPage() {
  const { catalogs } = useSystemCatalogs();
  const SUBJECTS = catalogs.subjects.length ? catalogs.subjects : FALLBACK_SUBJECTS;
  const LANGUAGES = catalogs.languages.length ? catalogs.languages : FALLBACK_LANGUAGES;
  const SKILL_SUGGESTIONS = catalogs.skill_suggestions.length ? catalogs.skill_suggestions : FALLBACK_SKILLS;
  const { wallet, loading: wBalanceLoading, isFetching: wFetching, refetch: refetchWallet } = useWallet()
  const { withdrawals, loading: wLoading, refetch: refetchW } = useMyWithdrawals()
  const { income, loading: iLoading, refetch: refetchI } = useMyIncome()
  const iFetchLoading = iLoading
  
  const [showModal, setShowModal] = useState(false)

  const isGlobalFetching = Boolean(wFetching || wLoading || iFetchLoading)

  const handleRefreshAll = () => {
    refetchWallet?.()
    refetchW?.()
    refetchI?.()
  }

  return (
    <div className="space-y-8 animate-fade-up max-w-5xl mx-auto pb-12 px-4 sm:px-6 lg:px-8">
      {/* Header con Refresco */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl sm:text-4xl font-black text-slate-800 mb-2 tracking-tight">
            Mis Ganancias
          </h1>
          <p className="text-slate-500 font-medium text-sm sm:text-base">
            Gestiona tu saldo acumulado y revisa el historial financiero de ingresos y retiros.
          </p>
        </div>
        <RefreshButton onRefresh={handleRefreshAll} isFetching={isGlobalFetching} className="mt-1 flex-shrink-0" />
      </div>

      {/* Bloque 1 — Resumen financiero (Skeletons e Iconos) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
        {wBalanceLoading ? (
          [1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-[2rem] border border-slate-100 p-6 space-y-3 shadow-sm">
              <Skeleton className="w-10 h-10 rounded-2xl" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-28" />
            </div>
          ))
        ) : (
          <>
            <Card className="p-6 flex flex-col justify-between relative overflow-hidden">
              <div>
                <div className="flex items-center gap-2 text-slate-400 mb-3">
                  <WalletIcon className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs font-black uppercase tracking-widest">Disponible</span>
                </div>
                <p className="text-3xl font-black text-slate-800 mb-4">${(wallet?.available_balance ?? 0).toFixed(2)}</p>
              </div>
              <button
                onClick={() => setShowModal(true)}
                disabled={!wallet || wallet.available_balance <= 0}
                className="w-full py-2.5 text-xs font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-md shadow-pink-100 hover:shadow-lg active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none"
              >
                Solicitar Retiro
              </button>
            </Card>

            <Card className="p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-slate-400 mb-3">
                  <TrendingUp className="w-4 h-4 text-pink-500" />
                  <span className="text-xs font-black uppercase tracking-widest">Ganancias Totales</span>
                </div>
                <p className="text-3xl font-black text-slate-800">${(wallet?.total_earned ?? 0).toFixed(2)}</p>
              </div>
              <p className="text-[11px] font-bold text-slate-400 mt-2">Histórico acumulado</p>
            </Card>

            <Card className="p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-slate-400 mb-3">
                  <CheckCircle2 className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-black uppercase tracking-widest">Total Retirado</span>
                </div>
                <p className="text-3xl font-black text-slate-800">${(wallet?.total_withdrawn ?? 0).toFixed(2)}</p>
              </div>
              <p className="text-[11px] font-bold text-slate-400 mt-2">Transferencias enviadas</p>
            </Card>
          </>
        )}
      </div>

      {/* Grid de Historiales Móvil / Desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Bloque 2 — Historial de retiros */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <ArrowUpRight className="w-4 h-4 text-rose-500" /> Historial de retiros
            </h2>
          </div>
          <Card className="overflow-hidden">
            {wLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-16 w-full rounded-2xl" />
                ))}
              </div>
            ) : !withdrawals || withdrawals.length === 0 ? (
              <p className="p-8 text-center text-xs text-slate-400 font-bold">Aún no has solicitado retiros</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {withdrawals.map(w => (
                  <div key={w.id} className="p-4 flex items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-black text-slate-800">${w.amount.toFixed(2)}</p>
                      <p className="text-xs text-slate-500 truncate max-w-[160px] sm:max-w-xs">{w.destination_details}</p>
                      <p className="text-[10px] text-slate-400 font-medium">
                        {new Date(w.created_at).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                      {w.rejection_reason && <p className="text-[10px] text-rose-500 font-bold">{w.rejection_reason}</p>}
                    </div>
                    <Badge variant={STATUS_BADGE[w.status]}>{STATUS_LABEL[w.status] ?? w.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Bloque 2b — Historial de ingresos */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <ArrowDownLeft className="w-4 h-4 text-emerald-500" /> Historial de ingresos
            </h2>
          </div>
          <Card className="overflow-hidden">
            {iLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-16 w-full rounded-2xl" />
                ))}
              </div>
            ) : !income || income.length === 0 ? (
              <p className="p-8 text-center text-xs text-slate-400 font-bold">Sin ingresos registrados todavía</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {income.map(p => (
                  <div key={p.id} className="p-4 flex items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors">
                    <div className="space-y-0.5">
                      <p className="text-sm font-bold text-slate-800">
                        {p.payment_type === 'package'
                          ? `Paquete${p.installment_number ? ` — cuota ${p.installment_number}` : ''}`
                          : 'Clase suelta'}
                      </p>
                      <p className="text-[10px] text-slate-400 font-medium">
                        {new Date(p.created_at).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                      <p className="text-sm font-black text-emerald-600">
                        {p.status === 'approved' ? `+$${p.amount_teacher.toFixed(2)}` : '—'}
                      </p>
                      <Badge variant={STATUS_BADGE[p.status]}>{STATUS_LABEL[p.status] ?? p.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {showModal && wallet && (
        <RequestWithdrawalModal
          available={wallet.available_balance}
          onClose={() => setShowModal(false)}
          onDone={() => handleRefreshAll()}
        />
      )}

      <ChipiWidget screenName="wallet_teacher" />
    </div>
  )
}