'use client'

import { useState } from 'react'
import { useAdminStats, usePendingPayments } from '@/hooks/useAdminData'
import StatCard from '@/components/ui/StatCard'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import api from '@/lib/api'

export default function AdminDashboard() {
  const { stats, loading: statsLoading } = useAdminStats()
  const { payments, loading: paymentsLoading, refetch } = usePendingPayments()
  const [validating, setValidating] = useState<number | null>(null)
  const [meetLink, setMeetLink] = useState('')
  const [activePayment, setActivePayment] = useState<number | null>(null)

  const handleApprove = async (paymentId: number) => {
    if (!meetLink.trim()) return
    setValidating(paymentId)
    try {
      await api.patch(`/payments/${paymentId}/validate`, {
        action: 'approve',
        meet_link: meetLink,
      })
      setMeetLink('')
      setActivePayment(null)
      refetch()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error aprobando pago')
    } finally {
      setValidating(null)
    }
  }

  const handleReject = async (paymentId: number) => {
    const reason = prompt('Motivo del rechazo:')
    if (!reason) return
    setValidating(paymentId)
    try {
      await api.patch(`/payments/${paymentId}/validate`, {
        action: 'reject',
        rejection_reason: reason,
      })
      refetch()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error rechazando pago')
    } finally {
      setValidating(null)
    }
  }

  return (
    <div className="space-y-10 animate-fade-up bg-white min-h-screen p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-100">

      {/* ─── Header ──────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold text-slate-800 mb-2 tracking-tight">
            Dashboard General
          </h1>
          <p className="text-sm text-slate-500 font-medium">
            Visión general de la plataforma, métricas y pagos en tiempo real
          </p>
        </div>
        <Badge variant="pink" className="py-2 px-4 shadow-sm hidden md:inline-flex">
          <span className="flex h-2 w-2 rounded-full bg-pink-500 animate-pulse mr-2" />
          Admin Live
        </Badge>
      </div>

      {/* ─── KPIs principales ────────────────────────────── */}
      {statsLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-slate-50 border border-pink-50 rounded-3xl h-32 animate-pulse" />
          ))}
        </div>
      ) : stats ? (
        <div className="space-y-8">
          {/* Fila 1 — Usuarios */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-1.5 h-5 bg-pink-500 rounded-full" />
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                Comunidad
              </h2>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-up animate-fade-up-delay-1">
              <StatCard
                label="Total usuarios"
                value={stats.total_users.toLocaleString()}
                change={`+${stats.new_users_this_week} esta semana`}
                changeType="up"
                icon={
                  <div className="p-2 bg-pink-50 text-pink-500 rounded-xl">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/></svg>
                  </div>
                }
              />
              <StatCard
                label="Estudiantes"
                value={stats.total_students.toLocaleString()}
                icon={
                  <div className="p-2 bg-rose-50 text-rose-500 rounded-xl">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"/></svg>
                  </div>
                }
              />
              <StatCard
                label="Profesores activos"
                value={stats.total_teachers_approved}
                icon={
                  <div className="p-2 bg-emerald-50 text-emerald-500 rounded-xl">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z"/></svg>
                  </div>
                }
              />
              <StatCard
                label="Pendientes aprobación"
                value={stats.total_teachers_pending}
                changeType={stats.total_teachers_pending > 0 ? 'warning' : 'neutral'}
                change={stats.total_teachers_pending > 0 ? 'Requieren revisión' : undefined}
                icon={
                  <div className="p-2 bg-amber-50 text-amber-500 rounded-xl">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/></svg>
                  </div>
                }
              />
            </div>
          </div>

          {/* Fila 2 — Clases */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-1.5 h-5 bg-rose-400 rounded-full" />
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                Rendimiento de Clases
              </h2>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-up animate-fade-up-delay-2">
              <StatCard
                label="Total clases"
                value={stats.total_classes.toLocaleString()}
                change={`+${stats.new_classes_this_week} esta semana`}
                changeType="up"
              />
              <StatCard
                label="Este mes"
                value={stats.classes_this_month}
              />
              <StatCard
                label="Completadas"
                value={stats.classes_completed.toLocaleString()}
                changeType="up"
              />
              <StatCard
                label="Canceladas"
                value={stats.classes_cancelled}
                changeType={stats.classes_cancelled > 0 ? 'down' : 'neutral'}
              />
            </div>
          </div>

          {/* Fila 3 — Finanzas */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-1.5 h-5 bg-emerald-400 rounded-full" />
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                Finanzas
              </h2>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-up animate-fade-up-delay-3">
              <StatCard
                label="Revenue total"
                value={`$${stats.total_revenue.toLocaleString('en', { minimumFractionDigits: 2 })}`}
                changeType="up"
              />
              <StatCard
                label="Pagado a profesores"
                value={`$${stats.total_paid_to_teachers.toLocaleString('en', { minimumFractionDigits: 2 })}`}
              />
              <StatCard
                label="Comisiones plataforma"
                value={`$${stats.total_platform_earnings.toLocaleString('en', { minimumFractionDigits: 2 })}`}
                changeType="up"
              />
              <StatCard
                label="Retiros pendientes"
                value={`$${stats.pending_withdrawals.toLocaleString('en', { minimumFractionDigits: 2 })}`}
                changeType={stats.pending_withdrawals > 0 ? 'warning' : 'neutral'}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* ─── Pagos pendientes de validación ──────────────── */}
      <div className="animate-fade-up animate-fade-up-delay-4 pt-4">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="font-display text-2xl font-bold text-slate-800">
              Comprobantes por validar
            </h2>
            <p className="text-sm text-slate-500 mt-1 font-medium">
              Revisa cada comprobante y aprueba o rechaza el pago
            </p>
          </div>
          {payments.length > 0 && (
            <Badge variant="warning" className="px-4 py-1.5 shadow-sm text-sm">
              {payments.length} pendientes
            </Badge>
          )}
        </div>

        {paymentsLoading ? (
          <div className="space-y-4">
            {[1, 2].map(i => (
              <div key={i} className="bg-slate-50 border border-slate-100 rounded-2xl h-28 animate-pulse" />
            ))}
          </div>
        ) : payments.length === 0 ? (
          <Card className="p-16 text-center bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-3xl shadow-none">
            <div className="text-5xl mb-4 drop-shadow-sm">✅</div>
            <p className="text-slate-500 font-medium text-lg">
              Todo al día. No hay comprobantes pendientes.
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {payments.map((payment) => (
              <Card key={payment.payment_id} hover className="p-6 border-slate-100 shadow-sm rounded-3xl">
                <div className="flex flex-col md:flex-row items-start gap-6">

                  {/* Recibo thumbnail */}
                  {payment.receipt_url && (
                    <a
                      href={payment.receipt_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 group"
                    >
                      <div className="relative w-20 h-20 md:w-24 md:h-24 rounded-2xl overflow-hidden border-2 border-slate-100 group-hover:border-pink-300 transition-all shadow-sm">
                        <img
                          src={payment.receipt_url}
                          alt="Comprobante"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="bg-white/90 text-pink-600 text-[10px] font-bold px-2 py-1 rounded-full shadow-sm">
                            Ampliar ↗
                          </span>
                        </div>
                      </div>
                    </a>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0 w-full">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className="text-slate-800 font-bold text-lg">
                        {payment.student_name}
                      </span>
                      <span className="text-slate-400 text-sm font-medium">
                        @{payment.student_username}
                      </span>
                      <Badge variant={payment.payment_method === 'binance' ? 'gold' : 'info'}>
                        {payment.payment_method}
                      </Badge>
                      <span className="text-pink-500 font-black text-lg md:ml-auto bg-pink-50 px-3 py-1 rounded-full">
                        ${payment.amount.toFixed(2)}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500 mb-5 font-medium">
                      <span className="flex items-center gap-1.5">
                        <span className="text-slate-400">TX:</span> 
                        <span className="bg-slate-100 px-2 py-0.5 rounded-md font-mono text-xs text-slate-600">
                          {payment.transaction_id}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="text-slate-400">📅 Clase:</span> 
                        {new Date(payment.class_start_utc).toLocaleString('es', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                        })}
                      </span>
                    </div>

                    {/* Formulario de aprobación */}
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
                            className="whitespace-nowrap"
                          >
                            Confirmar
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => setActivePayment(null)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-3">
                        <Button
                          variant="primary"
                          onClick={() => setActivePayment(payment.payment_id)}
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
                        {payment.receipt_url && (
                          <a
                            href={payment.receipt_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Button variant="secondary" className="text-slate-500">
                              Ver original ↗
                            </Button>
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}