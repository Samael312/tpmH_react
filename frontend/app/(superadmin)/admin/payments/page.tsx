'use client'

import { useState } from 'react'
import { usePendingPayments, useWithdrawals } from '@/hooks/useAdminData'
import { Card, Badge, Button } from '@/components/ui'
import api from '@/lib/api'

const PAYMENT_METHOD_BADGE: Record<string, 'gold' | 'info'> = {
  binance: 'gold',
  paypal:  'info',
}

export default function PaymentsPage() {
  const [activeTab, setActiveTab] = useState<'receipts' | 'withdrawals'>('receipts')
  const [validating, setValidating] = useState<number | null>(null)
  const [processing, setProcessing] = useState<number | null>(null)
  const [meetLink, setMeetLink] = useState('')
  const [activePayment, setActivePayment] = useState<number | null>(null)

  const { payments, loading: paymentsLoading, refetch: refetchPayments } = usePendingPayments()
  const { withdrawals, loading: withdrawalsLoading, refetch: refetchWithdrawals } = useWithdrawals()

  const handleApprove = async (paymentId: number) => {
    if (!meetLink.trim()) {
      alert('El link de Google Meet es obligatorio para aprobar')
      return
    }
    setValidating(paymentId)
    try {
      await api.patch(`/payments/${paymentId}/validate`, {
        action: 'approve',
        meet_link: meetLink,
      })
      setMeetLink('')
      setActivePayment(null)
      refetchPayments()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error aprobando')
    } finally {
      setValidating(null)
    }
  }

  const handleReject = async (paymentId: number) => {
    const reason = prompt('Motivo del rechazo (se notifica al estudiante):')
    if (!reason) return
    setValidating(paymentId)
    try {
      await api.patch(`/payments/${paymentId}/validate`, {
        action: 'reject',
        rejection_reason: reason,
      })
      refetchPayments()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error rechazando')
    } finally {
      setValidating(null)
    }
  }

  const handleProcessWithdrawal = async (withdrawalId: number) => {
    setProcessing(withdrawalId)
    try {
      await api.patch(
        `/payments/withdrawals/${withdrawalId}/process?action=complete`
      )
      refetchWithdrawals()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error procesando retiro')
    } finally {
      setProcessing(null)
    }
  }

  const handleRejectWithdrawal = async (withdrawalId: number) => {
    const reason = prompt('Motivo del rechazo:')
    if (!reason) return
    setProcessing(withdrawalId)
    try {
      await api.patch(
        `/payments/withdrawals/${withdrawalId}/process`,
        null,
        { params: { action: 'reject', rejection_reason: reason } }
      )
      refetchWithdrawals()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error')
    } finally {
      setProcessing(null)
    }
  }

  return (
    <div className="space-y-8 animate-fade-up bg-white min-h-screen p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-100">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-4xl font-bold text-slate-800 mb-2 tracking-tight">
            Gestión de Pagos
          </h1>
          <p className="text-sm text-slate-500 font-medium">
            Valida comprobantes de estudiantes y procesa retiros de profesores
          </p>
        </div>
      </div>

      {/* Tabs "Pill" modernos */}
      <div className="flex gap-2 bg-slate-50 border border-slate-100 rounded-2xl p-1.5 w-max shadow-inner overflow-x-auto custom-scrollbar max-w-full">
        {[
          { key: 'receipts',    label: `Comprobantes (${payments?.length || 0})` },
          { key: 'withdrawals', label: `Retiros (${withdrawals?.length || 0})` },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`
              px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 whitespace-nowrap
              ${activeTab === tab.key
                ? 'bg-white text-pink-600 shadow-sm border border-pink-100'
                : 'text-slate-400 hover:text-pink-500 hover:bg-white/50'
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Comprobantes ─────────────────────────────────── */}
      {activeTab === 'receipts' && (
        <div className="space-y-4 pt-2">
          {paymentsLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-slate-50 border border-slate-100 rounded-3xl h-32 animate-pulse" />
            ))
          ) : payments?.length === 0 ? (
            <Card className="p-16 text-center bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-3xl shadow-none">
              <div className="text-5xl mb-4 drop-shadow-sm opacity-60">✅</div>
              <p className="text-slate-500 font-bold text-lg">
                No hay comprobantes pendientes de validación
              </p>
            </Card>
          ) : payments?.map((payment) => (
            <Card key={payment.payment_id} hover className="p-6 border-slate-100 shadow-sm rounded-3xl group">
              <div className="flex flex-col md:flex-row items-start gap-6">

                {/* Thumbnail del comprobante */}
                {payment.receipt_url ? (
                  <a
                    href={payment.receipt_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 w-24 h-24 relative rounded-2xl overflow-hidden border-2 border-slate-100 group-hover:border-pink-300 transition-all shadow-sm"
                  >
                    <img
                      src={payment.receipt_url}
                      alt="Comprobante"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="bg-white/90 text-pink-600 text-[10px] font-bold px-2 py-1 rounded-full shadow-sm">
                        Ver ↗
                      </span>
                    </div>
                  </a>
                ) : (
                  <div className="w-24 h-24 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex flex-col items-center justify-center flex-shrink-0">
                    <span className="text-slate-300 text-2xl mb-1">📄</span>
                    <span className="text-slate-400 text-[10px] font-bold uppercase">Sin img</span>
                  </div>
                )}

                {/* Info del pago */}
                <div className="flex-1 min-w-0 w-full">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <span className="text-slate-800 font-bold text-lg">
                      {payment.student_name}
                    </span>
                    <span className="text-slate-400 text-sm font-medium">
                      @{payment.student_username}
                    </span>
                    <Badge variant={PAYMENT_METHOD_BADGE[payment.payment_method] || 'neutral'} className="shadow-sm">
                      {payment.payment_method}
                    </Badge>
                    <span className="text-pink-500 font-black text-xl md:ml-auto bg-pink-50 px-3 py-1 rounded-xl">
                      ${payment.amount?.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500 mb-5 font-medium">
                    <span className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">
                      <span className="text-slate-400 uppercase font-black text-[10px] tracking-widest">TX</span> 
                      <span className="font-mono text-slate-600">
                        {payment.transaction_id || 'N/A'}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">
                      <span className="text-slate-400 uppercase font-black text-[10px] tracking-widest">Clase</span> 
                      <span className="text-slate-600">
                        {payment.class_start_utc
                          ? new Date(payment.class_start_utc).toLocaleString('es', {
                              day: 'numeric', month: 'short',
                              hour: '2-digit', minute: '2-digit'
                            }) + ' UTC'
                          : 'N/A'
                        }
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">
                      <span className="text-slate-400 uppercase font-black text-[10px] tracking-widest">Enviado</span> 
                      <span className="text-slate-600">
                        {new Date(payment.submitted_at).toLocaleString('es', {
                          day: 'numeric', month: 'short',
                          hour: '2-digit', minute: '2-digit'
                        })}
                      </span>
                    </span>
                  </div>

                  {/* Acciones */}
                  {activePayment === payment.payment_id ? (
                    <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <input
                        type="url"
                        value={meetLink}
                        onChange={e => setMeetLink(e.target.value)}
                        placeholder="https://meet.google.com/xxx-xxxx-xxx"
                        className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-pink-50 focus:border-pink-300 transition-all"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="primary"
                          loading={validating === payment.payment_id}
                          onClick={() => handleApprove(payment.payment_id)}
                          className="whitespace-nowrap shadow-md shadow-pink-200"
                        >
                          Confirmar
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setActivePayment(null)
                            setMeetLink('')
                          }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        variant="primary"
                        onClick={() => setActivePayment(payment.payment_id)}
                        className="shadow-sm"
                      >
                        Aprobar pago
                      </Button>
                      <Button
                        variant="danger"
                        loading={validating === payment.payment_id}
                        onClick={() => handleReject(payment.payment_id)}
                      >
                        Rechazar
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ─── Retiros ──────────────────────────────────────── */}
      {activeTab === 'withdrawals' && (
        <div className="space-y-4 pt-2">
          {withdrawalsLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-slate-50 border border-slate-100 rounded-3xl h-24 animate-pulse" />
            ))
          ) : withdrawals?.length === 0 ? (
            <Card className="p-16 text-center bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-3xl shadow-none">
              <div className="text-5xl mb-4 drop-shadow-sm opacity-60">🏧</div>
              <p className="text-slate-500 font-bold text-lg">
                No hay solicitudes de retiro pendientes
              </p>
            </Card>
          ) : withdrawals?.map((withdrawal) => (
            <Card key={withdrawal.id} hover className="p-6 border-slate-100 shadow-sm rounded-3xl group">
              <div className="flex flex-col md:flex-row md:items-center gap-6">

                {/* Avatar */}
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-50 border border-emerald-200 flex items-center justify-center flex-shrink-0 shadow-inner group-hover:scale-105 transition-transform">
                    <span className="text-emerald-600 font-black text-xl">
                      {withdrawal.teacher_name?.[0] || 'P'}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-slate-800 font-bold text-lg truncate">
                        {withdrawal.teacher_name}
                      </span>
                      <Badge variant="warning" className="shadow-sm">Pendiente</Badge>
                    </div>
                    <div className="text-sm font-medium text-slate-400 truncate">
                      @{withdrawal.teacher_username}
                      <span className="mx-2">•</span>
                      Solicitado el {new Date(withdrawal.created_at).toLocaleDateString('es', {
                        day: 'numeric', month: 'short', year: 'numeric'
                      })}
                    </div>
                  </div>
                </div>

                {/* Monto y Acciones */}
                <div className="flex flex-wrap md:flex-nowrap items-center gap-6 bg-slate-50 px-6 py-4 rounded-2xl border border-slate-100 md:ml-auto">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Monto</span>
                    <span className="text-xl font-black text-emerald-500">
                      ${withdrawal.amount?.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex gap-2 w-full md:w-auto">
                    <Button
                      variant="primary"
                      loading={processing === withdrawal.id}
                      onClick={() => handleProcessWithdrawal(withdrawal.id)}
                      className="flex-1 md:flex-none shadow-md shadow-pink-200"
                    >
                      Marcar Pagado
                    </Button>
                    <Button
                      variant="danger"
                      loading={processing === withdrawal.id}
                      onClick={() => handleRejectWithdrawal(withdrawal.id)}
                      className="flex-1 md:flex-none"
                    >
                      Rechazar
                    </Button>
                  </div>
                </div>

              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}