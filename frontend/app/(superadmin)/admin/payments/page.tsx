'use client'

import { useState } from 'react'
import { usePendingPayments, useWithdrawals } from '@/hooks/useAdminData'
import { useTeachers } from '@/hooks/useAdminData'
import { Card, Badge, Button } from '@/components/ui'
import api from '@/lib/api'
import ChipiWidget from '@/components/chipi/ChipiWidget'
import Link from 'next/link'
import { ChevronRight, Clock, Check, X } from 'lucide-react'

const TYPE_BADGE: Record<string, { label: (p: any) => string; cls: string }> = {
  single_class:       { label: () => "Clase única", cls: "bg-blue-100 text-blue-700" },
  package:            { label: p => p.installment_total ? `Cuota ${p.installment_index}/${p.installment_total}` : "Paquete", cls: "bg-pink-100 text-pink-700" },
  unlimited_recharge: { label: p => `Recarga ${p.installment_index} clases`, cls: "bg-purple-100 text-purple-700" },
}

export default function PaymentsPage() {
  const [activeTab, setActiveTab] = useState<'payments' | 'withdrawals' | 'teachers'>('payments')
  const [validating, setValidating] = useState<number | null>(null)
  const [processing, setProcessing] = useState<number | null>(null)
  const [meetLink, setMeetLink] = useState('')
  const [activePayment, setActivePayment] = useState<number | null>(null)

  const { payments, loading: paymentsLoading, refetch: refetchPayments } = usePendingPayments()
  const { withdrawals, loading: withdrawalsLoading, refetch: refetchWithdrawals } = useWithdrawals()
  const { teachers: pendingTeachers, loading: teachersLoading } = useTeachers('pending')

  const handleApprove = async (p: any) => {
    setValidating(p.payment_id)
    try {
      await api.patch(`/payments/${p.payment_id}/validate`, {
        action: 'approve',
        ...(p.payment_type === 'single_class' ? { meet_link: meetLink } : {}),
      })
      setMeetLink(''); setActivePayment(null)
      refetchPayments()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error aprobando')
    } finally { setValidating(null) }
  }

  const handleReject = async (p: any) => {
    const reason = prompt('Motivo del rechazo:')
    if (!reason) return
    setValidating(p.payment_id)
    try {
      await api.patch(`/payments/${p.payment_id}/validate`, { action: 'reject', rejection_reason: reason })
      refetchPayments()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error rechazando')
    } finally { setValidating(null) }
  }

  const handleProcessWithdrawal = async (id: number) => {
    setProcessing(id)
    try {
      await api.post(`/payments/admin/withdrawals/${id}/process`, { action: 'complete' })
      refetchWithdrawals()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error procesando retiro')
    } finally { setProcessing(null) }
  }

  const handleRejectWithdrawal = async (id: number) => {
    const reason = prompt('Motivo del rechazo:')
    if (!reason) return
    setProcessing(id)
    try {
      await api.post(`/payments/admin/withdrawals/${id}/process`, { action: 'reject', rejection_reason: reason })
      refetchWithdrawals()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error')
    } finally { setProcessing(null) }
  }

  return (
    <div className="space-y-8 animate-fade-up bg-white min-h-screen p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
      <div>
        <h1 className="font-display text-4xl font-bold text-slate-800 mb-2 tracking-tight">
          Pagos y Retiros
        </h1>
        <p className="text-sm text-slate-500 font-medium">
          Confirma cobros de estudiantes, procesa retiros de profesores y revisa perfiles nuevos
        </p>
      </div>

      <div className="flex gap-2 bg-slate-50 border border-slate-100 rounded-2xl p-1.5 w-max shadow-inner overflow-x-auto max-w-full">
        {[
          { key: 'payments',    label: `Pagos por confirmar (${payments?.length || 0})` },
          { key: 'withdrawals', label: `Retiros (${withdrawals?.length || 0})` },
          { key: 'teachers',    label: `Profesores por validar (${pendingTeachers?.length || 0})` },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as any)}
            className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 whitespace-nowrap ${
              activeTab === tab.key ? 'bg-white text-pink-600 shadow-sm border border-pink-100' : 'text-slate-400 hover:text-pink-500'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'payments' && (
        <div className="space-y-4 pt-2">
          {paymentsLoading ? (
            Array.from({ length: 3 }).map((_, i) => <div key={i} className="bg-slate-50 rounded-3xl h-28 animate-pulse" />)
          ) : payments?.length === 0 ? (
            <Card className="p-16 text-center bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-3xl shadow-none">
              <div className="text-5xl mb-4 opacity-60">✅</div>
              <p className="text-slate-500 font-bold text-lg">No hay pagos pendientes de confirmación</p>
            </Card>
          ) : payments?.map((p: any) => {
            const badge = TYPE_BADGE[p.payment_type] || TYPE_BADGE.package
            return (
              <Card key={p.payment_id} hover className="p-6 border-slate-100 shadow-sm rounded-3xl">
                <div className="flex items-center gap-3 flex-wrap mb-2">
                  <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${badge.cls}`}>
                    {badge.label(p)}
                  </span>
                  <span className="text-slate-800 font-bold">{p.student_name}</span>
                  <span className="text-slate-400 text-sm">@{p.student_username}</span>
                  <span className="ml-auto text-pink-500 font-black text-lg bg-pink-50 px-3 py-1 rounded-xl">
                    ${p.amount.toFixed(2)}
                  </span>
                </div>
                {p.package_name && <p className="text-xs text-slate-500 mb-1">Paquete: {p.package_name}</p>}
                {p.transaction_reference && <p className="text-xs text-slate-400 font-mono mb-2">Ref: {p.transaction_reference}</p>}
                {p.payment_expires_at && (
                  <p className="text-xs text-amber-600 font-bold flex items-center gap-1 mb-3">
                    <Clock className="w-3.5 h-3.5" /> Expira: {new Date(p.payment_expires_at).toLocaleString('es')}
                  </p>
                )}

                {activePayment === p.payment_id ? (
                  <div className="flex flex-col sm:flex-row gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <input type="url" value={meetLink} onChange={e => setMeetLink(e.target.value)}
                      placeholder="https://meet.google.com/xxx-xxxx-xxx"
                      className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm" />
                    <div className="flex gap-2">
                      <Button variant="primary" loading={validating === p.payment_id} onClick={() => handleApprove(p)}>Confirmar</Button>
                      <Button variant="secondary" onClick={() => setActivePayment(null)}>Cancelar</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <Button variant="primary"
                      onClick={() => p.payment_type === 'single_class' ? setActivePayment(p.payment_id) : handleApprove(p)}>
                      Confirmar pago
                    </Button>
                    <Button variant="danger" loading={validating === p.payment_id} onClick={() => handleReject(p)}>Rechazar</Button>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {activeTab === 'withdrawals' && (
        <div className="space-y-4 pt-2">
          {withdrawalsLoading ? (
            Array.from({ length: 2 }).map((_, i) => <div key={i} className="bg-slate-50 rounded-3xl h-24 animate-pulse" />)
          ) : withdrawals?.length === 0 ? (
            <Card className="p-16 text-center bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-3xl shadow-none">
              <div className="text-5xl mb-4 opacity-60">🏧</div>
              <p className="text-slate-500 font-bold text-lg">No hay solicitudes de retiro pendientes</p>
            </Card>
          ) : withdrawals?.map((w: any) => (
            <Card key={w.id} hover className="p-6 border-slate-100 shadow-sm rounded-3xl">
              <div className="flex flex-col md:flex-row md:items-center gap-6">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-slate-800 font-bold text-lg">{w.teacher_name}</span>
                    <Badge variant="warning">Pendiente</Badge>
                  </div>
                  <p className="text-sm text-slate-400">@{w.teacher_username}</p>
                  <p className="text-xs text-slate-500 mt-1">{w.destination_details}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xl font-black text-emerald-500">${w.amount.toFixed(2)}</span>
                  <Button variant="primary" loading={processing === w.id} onClick={() => handleProcessWithdrawal(w.id)}>Marcar Pagado</Button>
                  <Button variant="danger" loading={processing === w.id} onClick={() => handleRejectWithdrawal(w.id)}>Rechazar</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {activeTab === 'teachers' && (
        <div className="space-y-4 pt-2">
          {teachersLoading ? (
            <div className="bg-slate-50 rounded-3xl h-24 animate-pulse" />
          ) : pendingTeachers?.length === 0 ? (
            <Card className="p-16 text-center bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-3xl shadow-none">
              <p className="text-slate-500 font-bold text-lg">No hay profesores pendientes de validación</p>
            </Card>
          ) : (
            <>
              {pendingTeachers?.slice(0, 5).map((t: any) => (
                <Card key={t.id} className="p-5 border-slate-100 shadow-sm rounded-2xl flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-800">{t.name} {t.surname}</p>
                    <p className="text-xs text-slate-400">@{t.username}</p>
                  </div>
                  <Badge variant="warning">Pendiente</Badge>
                </Card>
              ))}
              <Link href="/admin/teachers"
                className="flex items-center justify-center gap-1.5 text-sm font-bold text-pink-600 hover:text-pink-700 py-3">
                Ir a revisar todos <ChevronRight className="w-4 h-4" />
              </Link>
            </>
          )}
        </div>
      )}

      <ChipiWidget screenName="admin_payments" />
    </div>
  )
}