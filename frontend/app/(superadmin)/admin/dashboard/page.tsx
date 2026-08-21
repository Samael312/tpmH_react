'use client'

import { useState } from 'react'
import { useAdminStats, usePendingPayments, useNotifications } from '@/hooks/useAdminData'
import api from '@/lib/api'
import Link from 'next/link'
import StatCard from '@/components/ui/StatCard'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import ChipiWidget from '@/components/chipi/ChipiWidget'

export default function AdminDashboard() {
  const { stats, loading: statsLoading } = useAdminStats()
  const { payments, loading: paymentsLoading, refetch } = usePendingPayments()
  const [validating, setValidating] = useState<number | null>(null)
  const [meetLink, setMeetLink] = useState('')
  const [activePayment, setActivePayment] = useState<number | null>(null)
  const { notifications, loading: notifLoading, refetch: refetchNotif } = useNotifications(true)

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

  const markRead = async (id: number) => {
    try {
      await api.patch(`/admin/notifications/${id}/read`)
      refetchNotif()
    } catch {}
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
   <> 
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

      <div className="flex items-center justify-between mb-6">
  <div>
    <h2 className="font-display text-2xl font-bold text-slate-800">
      Pagos y profesores por confirmar
    </h2>
    <p className="text-sm text-slate-500 mt-1 font-medium">
      Revisa las notificaciones de pago y las solicitudes de nuevos profesores
    </p>
  </div>
  <div className="flex gap-2">
    {payments.length > 0 && <Badge variant="warning" className="px-4 py-1.5 shadow-sm text-sm">{payments.length} pagos</Badge>}
    {stats && stats.total_teachers_pending > 0 && (
      <Badge variant="warning" className="px-4 py-1.5 shadow-sm text-sm">{stats.total_teachers_pending} profesores</Badge>
    )}
  </div>
  {/* Notificaciones sin leer (videos nuevos, apelaciones) */}
  <div className="space-y-3">
    {notifLoading ? (
      <div className="h-16 bg-slate-50 rounded-2xl animate-pulse" />
    ) : notifications.length === 0 ? (
      <p className="text-xs text-slate-400 font-bold px-1">Sin notificaciones nuevas</p>
    ) : (
      notifications.map(n => (
        <div key={n.id} className="flex items-center justify-between gap-4 bg-amber-50 border border-amber-100 rounded-2xl px-5 py-3">
          <div>
            <p className="text-sm font-bold text-slate-800">{n.title}</p>
            {n.message && <p className="text-xs text-slate-500 mt-0.5">{n.message}</p>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link href="/admin/teachers" className="text-xs font-bold text-pink-600 hover:text-pink-700">
              Revisar
            </Link>
            <button onClick={() => markRead(n.id)} className="text-xs font-bold text-slate-400 hover:text-slate-600">
              Marcar leída
            </button>
          </div>
        </div>
      ))
    )}
        </div>
      </div>
    </div>
    <ChipiWidget screenName="admin_home" /> 
  </>
  )
}