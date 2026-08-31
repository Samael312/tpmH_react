// frontend/app/(superadmin)/admin/dashboard/page.tsx
'use client'

import { useState } from 'react'
import { useAdminStats, usePendingPayments, useNotifications } from '@/hooks/useAdminData'
import api from '@/lib/api'
import Link from 'next/link'
import StatCard from '@/components/ui/StatCard'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Skeleton from '@/components/ui/Skeleton'
import RefreshButton from '@/components/ui/RefreshButton'
import DesktopOnly from '@/components/ui/DesktopOnly'
import { usePageTopBar } from '@/lib/mobileTopBar'
import ChipiWidget from '@/components/chipi/ChipiWidget'
import { useToast } from '@/hooks/useToast'
import { getErrorMessage } from '@/lib/errorMessage'
import {
  Bell, CheckCheck, Video, MessageSquare, UserPlus,
  ChevronRight, Clock, CreditCard, Users, GraduationCap,
  AlertTriangle, RefreshCw,
} from 'lucide-react'

const NOTIF_ICON: Record<string, React.ReactNode> = {
  teacher_pending: <Video className="w-4 h-4" />,
  teacher_appeal: <MessageSquare className="w-4 h-4" />,
}

// ─── Sección de notificaciones (independiente, arriba de todo) ─────────────
function NotificationsSection() {
  const { notifications, loading, isError, refetch } = useNotifications(true)
  const toast = useToast()

  const markRead = async (id: number) => {
    try {
      await api.patch(`/admin/notifications/${id}/read`)
      refetch()
    } catch (e) {
      toast.error(getErrorMessage(e, 'No se pudo marcar la notificación como leída'))
    }
  }

  const markAllRead = async () => {
    try {
      await api.post('/admin/notifications/mark-all-read')
      refetch()
      toast.success('Todas las notificaciones marcadas como leídas')
    } catch (e) {
      toast.error(getErrorMessage(e, 'No se pudieron marcar las notificaciones como leídas'))
    }
  }

  return (
    <Card className="p-6 md:p-7 border-slate-100 shadow-sm rounded-3xl">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center relative flex-shrink-0">
            <Bell className="w-5 h-5" />
            {notifications.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">
                {notifications.length > 9 ? '9+' : notifications.length}
              </span>
            )}
          </div>
          <div>
            <h2 className="text-base font-black text-slate-800 tracking-tight">Notificaciones</h2>
            <p className="text-xs text-slate-400 font-medium">
              {notifications.length === 0
                ? 'Estás al día'
                : `${notifications.length} sin leer`}
            </p>
          </div>
        </div>

        {notifications.length > 0 && (
          <button
            onClick={markAllRead}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-pink-600 bg-slate-50 hover:bg-pink-50 px-3.5 py-2 rounded-xl transition-colors"
          >
            <CheckCheck className="w-3.5 h-3.5" /> Marcar todas como leídas
          </button>
        )}
      </div>

      {isError ? (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl px-4 py-3.5 flex items-center gap-3 flex-wrap">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="text-xs font-bold flex-1">No se pudieron cargar las notificaciones.</span>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-100 hover:bg-rose-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Reintentar
          </button>
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}
        </div>
      ) : notifications.length === 0 ? (
        <div className="bg-slate-50/60 border-2 border-dashed border-slate-100 rounded-2xl py-8 text-center">
          <p className="text-sm text-slate-400 font-bold">No tienes notificaciones nuevas 🎉</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {notifications.map(n => (
            <div
              key={n.id}
              className="flex items-center gap-3 bg-amber-50/70 border border-amber-100 rounded-2xl px-4 py-3.5"
            >
              <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0">
                {NOTIF_ICON[n.type] ?? <Bell className="w-4 h-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 truncate">{n.title}</p>
                {n.message && <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{n.message}</p>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Link
                  href="/admin/support"
                  className="text-xs font-bold text-pink-600 hover:text-pink-700 bg-white px-3 py-1.5 rounded-lg border border-pink-100 transition-colors"
                >
                  Revisar
                </Link>
                <button
                  onClick={() => markRead(n.id)}
                  className="text-xs font-bold text-slate-400 hover:text-slate-600 px-2 py-1.5"
                >
                  Marcar leída
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ─── Sección de pagos pendientes (acción rápida) ───────────────────────────
function PendingPaymentsSection() {
  const { payments, loading, isError, refetch } = usePendingPayments()
  const [validating, setValidating] = useState<number | null>(null)
  const toast = useToast()

  // BUG-04/12 fix: se eliminó "single_class" y el requisito de link de Meet
  // al aprobar (antes este widget ni siquiera dejaba aprobar sin meetLink,
  // aunque la mayoría de los pagos pendientes no son de ese tipo).
  const handleApprove = async (paymentId: number) => {
    setValidating(paymentId)
    try {
      await api.patch(`/payments/${paymentId}/validate`, { action: 'approve' })
      refetch()
      toast.success('Pago aprobado correctamente')
    } catch (e) {
      toast.error(getErrorMessage(e, 'No se pudo aprobar el pago'))
    } finally {
      setValidating(null)
    }
  }

  const handleReject = async (paymentId: number) => {
    const reason = prompt('Motivo del rechazo:')
    if (!reason) return
    setValidating(paymentId)
    try {
      await api.patch(`/payments/${paymentId}/validate`, { action: 'reject', rejection_reason: reason })
      refetch()
      toast.success('Pago rechazado correctamente')
    } catch (e) {
      toast.error(getErrorMessage(e, 'No se pudo rechazar el pago'))
    } finally {
      setValidating(null)
    }
  }

  return (
    <Card className="p-6 md:p-7 border-slate-100 shadow-sm rounded-3xl">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-pink-50 text-pink-500 flex items-center justify-center flex-shrink-0">
            <CreditCard className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-800 tracking-tight">Pagos por confirmar</h2>
            <p className="text-xs text-slate-400 font-medium">Clases sueltas esperando validación de comprobante</p>
          </div>
        </div>
        {payments.length > 0 && <Badge variant="warning">{payments.length}</Badge>}
      </div>

      {isError ? (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl px-4 py-3.5 flex items-center gap-3 flex-wrap">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="text-xs font-bold flex-1">No se pudieron cargar los pagos pendientes.</span>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-100 hover:bg-rose-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Reintentar
          </button>
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
        </div>
      ) : payments.length === 0 ? (
        <div className="bg-slate-50/60 border-2 border-dashed border-slate-100 rounded-2xl py-8 text-center">
          <p className="text-sm text-slate-400 font-bold">Sin pagos pendientes ✅</p>
        </div>
      ) : (
        <div className="space-y-3">
          {payments.slice(0, 5).map((p: any) => (
            <div key={p.payment_id} className="bg-slate-50/70 border border-slate-100 rounded-2xl p-4">
              <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                <span className="text-sm font-bold text-slate-800">{p.student_name}</span>
                <span className="text-pink-600 font-black bg-pink-50 px-3 py-1 rounded-full text-sm">
                  ${p.amount.toFixed(2)}
                </span>
              </div>
              {p.payment_expires_at && (
                <p className="text-[11px] text-amber-600 font-bold flex items-center gap-1 mb-3">
                  <Clock className="w-3 h-3" /> Expira: {new Date(p.payment_expires_at).toLocaleString('es')}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm" variant="primary" loading={validating === p.payment_id}
                  onClick={() => handleApprove(p.payment_id)}
                >
                  Confirmar
                </Button>
                <Button size="sm" variant="danger" loading={validating === p.payment_id} onClick={() => handleReject(p.payment_id)}>
                  Rechazar
                </Button>
              </div>
            </div>
          ))}
          <Link href="/admin/payments" className="flex items-center justify-center gap-1.5 text-sm font-bold text-pink-600 hover:text-pink-700 py-2">
            Ver todos los pagos <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      )}
    </Card>
  )
}

export default function AdminDashboard() {
  const { stats, loading: statsLoading, isError: statsError, refetch: refetchStats } = useAdminStats()
  const { refetch: refetchPayments, isFetching: paymentsFetching } = usePendingPayments()
  const { refetch: refetchNotifications, isFetching: notifFetching } = useNotifications(true)
  
  const isFetching = paymentsFetching || notifFetching
  
  const handleRefresh = () => {
    refetchStats()
    refetchPayments()
    refetchNotifications()
  }
  
  usePageTopBar({
    title: 'Dashboard General',
    onRefresh: handleRefresh,
    isFetching,
  })

  return (
    <>
      <div className="space-y-8 animate-fade-up bg-white min-h-screen p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-100">

        {/* ─── Header ─── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-display text-4xl font-bold text-slate-800 mb-2 tracking-tight">
              Dashboard General
            </h1>
            <p className="text-sm text-slate-500 font-medium">
              Visión general de la plataforma, métricas y pagos en tiempo real
            </p>
          </div>
          <div className="flex items-center gap-3">
            <DesktopOnly>
              <RefreshButton onRefresh={handleRefresh} isFetching={isFetching} />
            </DesktopOnly>
            <Badge variant="pink" className="py-2 px-4 shadow-sm hidden md:inline-flex">
              <span className="flex h-2 w-2 rounded-full bg-pink-500 animate-pulse mr-2" />
              Admin Live
            </Badge>
          </div>
        </div>

        {/* ─── Notificaciones: apartado propio, siempre arriba ─── */}
        <NotificationsSection />

        {/* ─── KPIs ─── */}
        {statsError ? (
          <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl px-4 py-3.5 flex items-center gap-3 flex-wrap">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="text-xs font-bold flex-1">No se pudieron cargar las métricas de la plataforma.</span>
            <button
              onClick={() => refetchStats()}
              className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-100 hover:bg-rose-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reintentar
            </button>
          </div>
        ) : statsLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-3xl" />
            ))}
          </div>
        ) : stats ? (
          <div className="space-y-8">
            {/* Comunidad */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-1.5 h-5 bg-pink-500 rounded-full" />
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Comunidad</h2>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  label="Total usuarios" value={stats.total_users.toLocaleString()}
                  change={`+${stats.new_users_this_week} esta semana`} changeType="up"
                  icon={<div className="p-2 bg-pink-50 text-pink-500 rounded-xl"><Users className="w-5 h-5" /></div>}
                />
                <StatCard
                  label="Estudiantes" value={stats.total_students.toLocaleString()}
                  icon={<div className="p-2 bg-rose-50 text-rose-500 rounded-xl"><GraduationCap className="w-5 h-5" /></div>}
                />
                <StatCard
                  label="Profesores activos" value={stats.total_teachers_approved}
                  icon={<div className="p-2 bg-emerald-50 text-emerald-500 rounded-xl"><Users className="w-5 h-5" /></div>}
                />
                <StatCard
                  label="Pendientes aprobación" value={stats.total_teachers_pending}
                  changeType={stats.total_teachers_pending > 0 ? 'warning' : 'neutral'}
                  change={stats.total_teachers_pending > 0 ? 'Requieren revisión' : undefined}
                  icon={<div className="p-2 bg-amber-50 text-amber-500 rounded-xl"><Clock className="w-5 h-5" /></div>}
                />
              </div>
            </div>

            {/* Clases */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-1.5 h-5 bg-rose-400 rounded-full" />
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Rendimiento de Clases</h2>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Total clases" value={stats.total_classes.toLocaleString()} change={`+${stats.new_classes_this_week} esta semana`} changeType="up" />
                <StatCard label="Este mes" value={stats.classes_this_month} />
                <StatCard label="Completadas" value={stats.classes_completed.toLocaleString()} changeType="up" />
                <StatCard label="Canceladas" value={stats.classes_cancelled} changeType={stats.classes_cancelled > 0 ? 'down' : 'neutral'} />
              </div>
            </div>

            {/* Finanzas */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-1.5 h-5 bg-emerald-400 rounded-full" />
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Finanzas</h2>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Revenue total" value={`$${stats.total_revenue.toLocaleString('en', { minimumFractionDigits: 2 })}`} changeType="up" />
                <StatCard label="Pagado a profesores" value={`$${stats.total_paid_to_teachers.toLocaleString('en', { minimumFractionDigits: 2 })}`} />
                <StatCard label="Comisiones plataforma" value={`$${stats.total_platform_earnings.toLocaleString('en', { minimumFractionDigits: 2 })}`} changeType="up" />
                <StatCard label="Retiros pendientes" value={`$${stats.pending_withdrawals.toLocaleString('en', { minimumFractionDigits: 2 })}`} changeType={stats.pending_withdrawals > 0 ? 'warning' : 'neutral'} />
              </div>
            </div>
          </div>
        ) : null}

        {/* ─── Acciones pendientes ─── */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1.5 h-5 bg-blue-400 rounded-full" />
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Acciones pendientes</h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PendingPaymentsSection />

            <Card className="p-6 md:p-7 border-slate-100 shadow-sm rounded-3xl">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-500 flex items-center justify-center flex-shrink-0">
                    <UserPlus className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-black text-slate-800 tracking-tight">Profesores pendientes</h2>
                    <p className="text-xs text-slate-400 font-medium">Perfiles nuevos esperando aprobación</p>
                  </div>
                </div>
                {stats && stats.total_teachers_pending > 0 && (
                  <Badge variant="warning">{stats.total_teachers_pending}</Badge>
                )}
              </div>

              {statsError ? (
                <div className="bg-rose-50/60 border border-rose-100 rounded-2xl py-6 text-center">
                  <p className="text-xs text-rose-500 font-bold">No se pudo verificar el estado de profesores pendientes</p>
                </div>
              ) : statsLoading ? (
                <Skeleton className="h-24 w-full rounded-2xl" />
              ) : !stats || stats.total_teachers_pending === 0 ? (
                <div className="bg-slate-50/60 border-2 border-dashed border-slate-100 rounded-2xl py-8 text-center">
                  <p className="text-sm text-slate-400 font-bold">Sin profesores pendientes ✅</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-slate-500">
                    Hay <strong className="text-slate-800">{stats.total_teachers_pending}</strong> profesor(es)
                    esperando revisión de video y aprobación de perfil.
                  </p>
                  <Link
                    href="/admin/teachers"
                    className="flex items-center justify-center gap-1.5 text-sm font-bold text-white bg-gradient-to-r from-pink-500 to-rose-400 hover:shadow-pink-200 hover:shadow-lg py-3 rounded-xl transition-all"
                  >
                    Revisar profesores <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
      <ChipiWidget screenName="admin_home" />
    </>
  )
}