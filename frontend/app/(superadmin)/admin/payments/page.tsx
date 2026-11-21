'use client'

import { useState } from 'react'
import { usePendingPayments, useWithdrawals, useTeachers, usePaymentsHistory, useManualGrantRequests, type ManualGrantRequestRecord, type PendingPayment, type WithdrawalRecord, type Teacher, type PaymentHistoryItem } from '@/hooks/useAdminData'
import { Card, Badge, Button, RejectReasonModal, ConfirmModal, FullScreenModal } from '@/components/ui'
import { useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import ChipiWidget from '@/components/chipi/ChipiWidget'
import Link from 'next/link'
import { ChevronRight, Clock, User, Package as PackageIcon, RefreshCw, AlertTriangle } from 'lucide-react'
import Skeleton from '@/components/ui/Skeleton'
import RefreshButton from '@/components/ui/RefreshButton'
import DesktopOnly from '@/components/ui/DesktopOnly'
import LoadMoreButton from '@/components/ui/LoadMoreButton'
import { usePageTopBar } from '@/lib/mobileTopBar'
import { useToast } from '@/hooks/useToast'
import { useAuthStore } from '@/store/authStore'
import { getErrorMessage } from '@/lib/errorMessage'

const TYPE_BADGE: Record<string, { label: (p: PendingPayment | PaymentHistoryItem) => string; cls: string }> = {
  package: {
    label: (p) => p.installment_total ? `Cuota ${p.installment_index ?? 1}/${p.installment_total}` : "Paquete Inicial",
    cls: "bg-pink-100 text-pink-700 border-pink-200"
  },
  renewal: {
    label: (p) => p.installment_total ? `Renovación (Cuota ${p.installment_index ?? 1}/${p.installment_total})` : "Renovación",
    cls: "bg-emerald-100 text-emerald-700 border-emerald-200"
  },
  package_renewal: {
    label: (p) => p.installment_total ? `Renovación (Cuota ${p.installment_index ?? 1}/${p.installment_total})` : "Renovación",
    cls: "bg-emerald-100 text-emerald-700 border-emerald-200"
  },
  package_change: {
    label: (p) => p.installment_total ? `Cambio (Cuota ${p.installment_index ?? 1}/${p.installment_total})` : "Cambio · Paquete Completo",
    cls: "bg-amber-100 text-amber-700 border-amber-200"
  },
  installment: {
    label: (p) => `Cuota ${p.installment_index || 1}/${p.installment_total || 1}`,
    cls: "bg-indigo-100 text-indigo-700 border-indigo-200"
  },
  unlimited_recharge: {
    label: (p) => `Recarga ${p.installment_index ? `${p.installment_index} clases` : "Ilimitada"}`,
    cls: "bg-purple-100 text-purple-700 border-purple-200"
  },
  refund: {
    label: () => "Reembolso a favor del estudiante",
    cls: "bg-rose-100 text-rose-700 border-rose-200"
  },
  group_enrollment: {
    label: () => "Inscripción a grupo",
    cls: "bg-indigo-100 text-indigo-700 border-indigo-200"
  },
}

// Correcciones Extra: el destino que el estudiante indicó para recibir su
// reembolso -- antes esta info se guardaba (refund_payment_info) pero
// nunca se mostraba en la card del pago, así que el staff no tenía cómo
// verla sin ir a buscarla a mano.
const REFUND_FIELD_LABELS: Record<string, string> = {
  bank_name: "Banco",
  bank_account: "Cuenta bancaria",
  account_holder: "Titular",
  mobile_payment: "Pago móvil",
  paypal_or_zelle: "PayPal / Zelle",
  other_notes: "Nota",
}

function RefundDestinationInfo({ info }: { info: PendingPayment["refund_payment_info"] }) {
  if (!info) return null
  const entries = Object.entries(info).filter(([, v]) => (v ?? "").toString().trim() !== "")
  if (entries.length === 0) return null
  return (
    <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3 mb-3 space-y-1">
      <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-1">
        Destino del reembolso
      </p>
      {entries.map(([key, value]) => (
        <p key={key} className="text-xs text-rose-700">
          {REFUND_FIELD_LABELS[key] || key}: <strong>{value}</strong>
        </p>
      ))}
    </div>
  )
}

export default function PaymentsPage() {
  const toast = useToast()
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<'payments' | 'withdrawals' | 'grants' | 'teachers' | 'history'>('payments')
  // Confirmaciones antes de mover dinero (aprobar pago / marcar retiro pagado con referencia / aprobar paquete gratis).
  const [approveTarget, setApproveTarget] = useState<PendingPayment | null>(null)
  const [payTarget, setPayTarget] = useState<WithdrawalRecord | null>(null)
  const [payReference, setPayReference] = useState('')
  const [grantApprove, setGrantApprove] = useState<ManualGrantRequestRecord | null>(null)
  const [grantReject, setGrantReject] = useState<ManualGrantRequestRecord | null>(null)
  const [grantBusy, setGrantBusy] = useState(false)
  // Tras mover dinero se refresca todo lo del admin (stats, colas, historial).
  const invalidateMoney = () => {
    qc.invalidateQueries({ queryKey: ['admin'] })
    qc.invalidateQueries({ queryKey: ['teacher', 'payments'] })
    qc.invalidateQueries({ queryKey: ['teacher', 'wallet'] })
  }
  const [validating, setValidating] = useState<number | null>(null)
  const [processing, setProcessing] = useState<number | null>(null)

  // Motivo de rechazo: se captura en RejectReasonModal en vez de window.prompt().
  // `target` guarda qué se está rechazando (pago o retiro) para que el modal
  // sea uno solo, reutilizado por ambos flujos.
  const [rejectTarget, setRejectTarget] = useState<
    | { kind: 'payment'; paymentId: number; label: string }
    | { kind: 'withdrawal'; withdrawalId: number; label: string }
    | null
  >(null)
  const [rejecting, setRejecting] = useState(false)

  const { payments, loading: paymentsLoading, isFetching: paymentsFetching, isError: paymentsError, refetch: refetchPayments } = usePendingPayments()
  const { withdrawals, loading: withdrawalsLoading, isFetching: withdrawalsFetching, isError: withdrawalsError, refetch: refetchWithdrawals } = useWithdrawals()
  const { requests: grantRequests, loading: grantsLoading, isFetching: grantsFetching, isError: grantsError, refetch: refetchGrants } = useManualGrantRequests('pending')
  const { teachers: pendingTeachers, total: pendingTeachersTotal, loading: teachersLoading, isFetching: teachersFetching, isError: teachersError, refetch: refetchTeachers } = useTeachers('pending')
  // El historial crece sin límite: se pide al abrir su pestaña y de 50 en 50 (Fase 14, E6).
  const { history, loading: historyLoading, isFetching: historyFetching, isError: historyError, refetch: refetchHistory, hasMore: historyHasMore, loadMore: loadMoreHistory, loadingMore: historyLoadingMore } = usePaymentsHistory(activeTab === 'history')

  const isFetching = paymentsFetching || withdrawalsFetching || teachersFetching || historyFetching || grantsFetching

  const handleRefreshAll = () => {
    refetchPayments()
    refetchWithdrawals()
    refetchTeachers()
    refetchHistory()
    refetchGrants()
  }

  usePageTopBar({
    title: 'Pagos y Retiros',
    onRefresh: handleRefreshAll,
    isFetching,
  })

  // BUG-04/12 fix: se eliminó el tipo de pago "single_class" — el link de
  // Meet ya no se pide al aprobar. Es opcional y el profesor lo carga por
  // clase, desde el ícono de video en cada clase confirmada.
  const handleApprove = async (p: PendingPayment) => {
    setValidating(p.payment_id)
    try {
      await api.patch(`/payments/${p.payment_id}/validate`, {
        action: 'approve',
      })
      invalidateMoney()
      setApproveTarget(null)
      toast.success('Pago aprobado correctamente')
    } catch (e) {
      toast.error(getErrorMessage(e, 'No se pudo aprobar el pago'))
    } finally {
      setValidating(null)
    }
  }

  const handleReject = (p: PendingPayment) => {
    setRejectTarget({
      kind: 'payment',
      paymentId: p.payment_id,
      label: `${p.student_name ? `${p.student_name} · ` : ''}$${Number(p.amount).toFixed(2)}`,
    })
  }

  const handleProcessWithdrawal = async (id: number, reference: string) => {
    setProcessing(id)
    try {
      await api.post(`/payments/admin/withdrawals/${id}/process`, {
        action: 'complete',
        reference: reference.trim() || undefined,
      })
      invalidateMoney()
      setPayTarget(null)
      setPayReference('')
      toast.success('Retiro procesado correctamente')
    } catch (e) {
      toast.error(getErrorMessage(e, 'No se pudo procesar el retiro'))
    } finally {
      setProcessing(null)
    }
  }

  const resolveGrant = async (g: ManualGrantRequestRecord, action: 'approve' | 'reject', reason?: string) => {
    setGrantBusy(true)
    try {
      await api.patch(`/payments/manual-grant-requests/${g.id}/resolve`, { action, rejection_reason: reason })
      invalidateMoney()
      toast.success(action === 'approve' ? 'Paquete otorgado' : 'Solicitud rechazada')
      setGrantApprove(null)
      setGrantReject(null)
    } catch (e) {
      toast.error(getErrorMessage(e, 'No se pudo resolver la solicitud'))
    } finally {
      setGrantBusy(false)
    }
  }

  const handleRejectWithdrawal = (id: number, teacherName?: string) => {
    setRejectTarget({
      kind: 'withdrawal',
      withdrawalId: id,
      label: teacherName || `Retiro #${id}`,
    })
  }

  // Confirmación única del RejectReasonModal: despacha al endpoint correcto
  // según qué se estaba rechazando (pago o retiro).
  const handleConfirmReject = async (reason: string) => {
    if (!rejectTarget) return
    setRejecting(true)
    try {
      if (rejectTarget.kind === 'payment') {
        setValidating(rejectTarget.paymentId)
        await api.patch(`/payments/${rejectTarget.paymentId}/validate`, {
          action: 'reject',
          rejection_reason: reason,
        })
        invalidateMoney()
      } else {
        setProcessing(rejectTarget.withdrawalId)
        await api.post(`/payments/admin/withdrawals/${rejectTarget.withdrawalId}/process`, {
          action: 'reject',
          rejection_reason: reason,
        })
        invalidateMoney()
      }
      toast.success(rejectTarget.kind === 'payment' ? 'Pago rechazado correctamente' : 'Retiro rechazado correctamente')
      setRejectTarget(null)
    } catch (e) {
      toast.error(getErrorMessage(e, `No se pudo rechazar ${rejectTarget.kind === 'payment' ? 'el pago' : 'el retiro'}`))
    } finally {
      setValidating(null)
      setProcessing(null)
      setRejecting(false)
    }
  }

  return (
    <>
      <div className="space-y-8 animate-fade-up bg-white min-h-screen p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl font-bold text-slate-800 mb-2 tracking-tight">
              Pagos y Retiros
            </h1>
            <p className="text-sm text-slate-500 font-medium">
              Cola unificada para validar cobros de estudiantes, cuotas, renovaciones y retiros de profesores
            </p>
          </div>
          <DesktopOnly>
            <RefreshButton onRefresh={handleRefreshAll} isFetching={isFetching} />
          </DesktopOnly>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 bg-slate-50 border border-slate-100 rounded-2xl p-1.5 w-max shadow-inner overflow-x-auto max-w-full">
          {[
            { key: 'payments',    label: `Pagos por confirmar (${payments?.length || 0})` },
            { key: 'withdrawals', label: `Retiros (${withdrawals?.length || 0})` },
            { key: 'grants',      label: `Paquetes gratis (${grantRequests?.length || 0})` },
            { key: 'teachers',    label: `Profesores por validar (${pendingTeachersTotal || 0})` },
            { key: 'history',     label: 'Historial' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as 'payments' | 'withdrawals' | 'grants' | 'teachers' | 'history')}
              className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-white text-pink-600 shadow-sm border border-pink-100'
                  : 'text-slate-400 hover:text-pink-500'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab 1: Payments Queue */}
        {activeTab === 'payments' && (
          <div className="space-y-4 pt-2">
            {paymentsError ? (
              <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl px-4 py-3.5 flex items-center gap-3 flex-wrap">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span className="text-xs font-bold flex-1">No se pudieron cargar los pagos pendientes.</span>
                <button
                  onClick={() => refetchPayments()}
                  className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-100 hover:bg-rose-200 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reintentar
                </button>
              </div>
            ) : paymentsLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full rounded-3xl" />)}
              </div>
            ) : payments?.length === 0 ? (
              <Card className="p-16 text-center bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-3xl shadow-none">
                <div className="text-5xl mb-4 opacity-60">✅</div>
                <p className="text-slate-500 font-bold text-lg">No hay pagos pendientes de confirmación</p>
              </Card>
            ) : (
              payments?.map((p: PendingPayment) => {
                const badge = TYPE_BADGE[p.payment_type] || {
                  label: () => p.payment_type || "Pago",
                  cls: "bg-slate-100 text-slate-700 border-slate-200"
                }

                return (
                  <Card key={p.payment_id} hover className="p-6 border-slate-100 shadow-sm rounded-3xl">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className={`text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full border ${badge.cls}`}>
                          {badge.label(p)}
                        </span>
                        <div className="flex items-center gap-1.5 font-bold text-slate-800">
                          <User className="w-4 h-4 text-slate-400" />
                          <span>{p.student_name}</span>
                          <span className="text-xs text-slate-400 font-normal">(@{p.student_username})</span>
                        </div>
                      </div>
                      <span className="text-pink-600 font-black text-xl bg-pink-50 px-4 py-1.5 rounded-2xl w-fit">
                        ${p.amount.toFixed(2)}
                      </span>
                    </div>

                    {/* Detalle adicional */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs text-slate-500 mb-4 bg-slate-50/70 p-3 rounded-2xl border border-slate-100">
                      {p.package_name && (
                        <div className="flex items-center gap-1.5">
                          <PackageIcon className="w-3.5 h-3.5 text-slate-400" />
                          <span>Paquete: <strong className="text-slate-700">{p.package_name}</strong></span>
                        </div>
                      )}
                      {p.teacher_name && (
                        <div>
                          Profesor: <strong className="text-slate-700">{p.teacher_name}</strong>
                        </div>
                      )}
                      {p.payment_method_label && (
                        <div>
                          Método: <strong className="text-slate-700">{p.payment_method_label}</strong>
                        </div>
                      )}
                      {p.transaction_reference && (
                        <div className="font-mono text-slate-400">
                          Ref: <strong className="text-slate-600">{p.transaction_reference}</strong>
                        </div>
                      )}
                      {p.submitted_at && (
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>Solicitado: <strong className="text-slate-700">{new Date(p.submitted_at).toLocaleString('es')}</strong></span>
                        </div>
                      )}
                    </div>

                    {p.payment_expires_at && (
                      <p className="text-xs text-amber-600 font-bold flex items-center gap-1 mb-3">
                        <Clock className="w-3.5 h-3.5" /> Expira: {new Date(p.payment_expires_at).toLocaleString('es')}
                      </p>
                    )}

                    <RefundDestinationInfo info={p.refund_payment_info} />

                    {/* Acciones */}
                    {p.is_own_payment ? (
                      <p className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-2 rounded-xl w-fit">
                        Pago de tus propias clases: lo resuelve el superadmin
                      </p>
                    ) : (
                    <div className="flex gap-3">
                      <Button
                        variant="primary"
                        loading={validating === p.payment_id}
                        onClick={() => setApproveTarget(p)}
                      >
                        Confirmar pago
                      </Button>
                      <Button
                        variant="danger"
                        loading={validating === p.payment_id}
                        onClick={() => handleReject(p)}
                      >
                        Rechazar
                      </Button>
                    </div>
                    )}
                  </Card>
                )
              })
            )}
          </div>
        )}

        {/* Tab 2: Withdrawals */}
        {activeTab === 'withdrawals' && (
          <div className="space-y-4 pt-2">
            {withdrawalsError ? (
              <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl px-4 py-3.5 flex items-center gap-3 flex-wrap">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span className="text-xs font-bold flex-1">No se pudieron cargar los retiros pendientes.</span>
                <button
                  onClick={() => refetchWithdrawals()}
                  className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-100 hover:bg-rose-200 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reintentar
                </button>
              </div>
            ) : withdrawalsLoading ? (
              <div className="space-y-4">
                {[1, 2].map(i => <Skeleton key={i} className="h-24 w-full rounded-3xl" />)}
              </div>
            ) : withdrawals?.length === 0 ? (
              <Card className="p-16 text-center bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-3xl shadow-none">
                <div className="text-5xl mb-4 opacity-60">🏧</div>
                <p className="text-slate-500 font-bold text-lg">No hay solicitudes de retiro pendientes</p>
              </Card>
            ) : (
              withdrawals?.map((w: WithdrawalRecord) => (
                <Card key={w.id} hover className="p-6 border-slate-100 shadow-sm rounded-3xl">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-slate-800 font-bold text-lg">{w.teacher_name}</span>
                        <Badge variant="warning">Pendiente</Badge>
                      </div>
                      <p className="text-sm text-slate-400">@{w.teacher_username}</p>
                      <p className="text-xs text-slate-500 mt-1 bg-slate-50 p-2 rounded-xl border border-slate-100 w-fit">
                        {w.destination_details}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xl font-black text-emerald-600 bg-emerald-50 px-4 py-2 rounded-2xl">
                        ${w.amount.toFixed(2)}
                      </span>
                      {user?.role === 'teacher_admin' && w.teacher_username === user.username ? (
                        <span className="text-xs font-bold text-slate-400 max-w-[11rem] text-right">
                          Tu retiro lo resuelve el superadmin
                        </span>
                      ) : (
                        <>
                          <Button
                            variant="primary"
                            loading={processing === w.id}
                            onClick={() => { setPayReference(''); setPayTarget(w) }}
                          >
                            Marcar Pagado
                          </Button>
                          <Button
                            variant="danger"
                            loading={processing === w.id}
                            onClick={() => handleRejectWithdrawal(w.id, w.teacher_name)}
                          >
                            Rechazar
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}

        {/* Tab: solicitudes de paquete gratis (Fase 20) */}
        {activeTab === 'grants' && (
          <div className="space-y-4 pt-2">
            {grantsError ? (
              <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl px-4 py-3.5 text-xs font-bold">
                No se pudieron cargar las solicitudes.{' '}
                <button onClick={() => refetchGrants()} className="underline">Reintentar</button>
              </div>
            ) : grantsLoading ? (
              <Skeleton className="h-24 w-full rounded-3xl" />
            ) : grantRequests.length === 0 ? (
              <Card className="p-16 text-center bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-3xl shadow-none">
                <p className="text-slate-500 font-bold text-lg">No hay solicitudes de paquete gratis pendientes</p>
              </Card>
            ) : (
              grantRequests.map((g) => {
                return (
                  <Card key={g.id} className="p-6 border-slate-100 shadow-sm rounded-3xl space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-bold text-slate-800">{g.student_name ?? `Alumno #${g.student_id}`}</p>
                        <p className="text-xs text-slate-500">
                          Pide: <strong>{g.teacher_name}</strong> · Paquete: <strong>{g.package_name ?? '—'}</strong>
                        </p>
                      </div>
                      <Badge variant="warning">Pendiente</Badge>
                    </div>
                    <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-2xl p-3 whitespace-pre-wrap">
                      {g.reason}
                    </p>
                    <div className="flex gap-3">
                      <Button variant="primary" onClick={() => setGrantApprove(g)}>Aprobar</Button>
                      <Button variant="danger" onClick={() => setGrantReject(g)}>Rechazar</Button>
                    </div>
                  </Card>
                )
              })
            )}
          </div>
        )}

        {/* Tab 3: Teachers Validation */}
        {activeTab === 'teachers' && (
          <div className="space-y-4 pt-2">
            {teachersError ? (
              <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl px-4 py-3.5 flex items-center gap-3 flex-wrap">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span className="text-xs font-bold flex-1">No se pudo cargar la lista de profesores pendientes.</span>
                <button
                  onClick={() => refetchTeachers()}
                  className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-100 hover:bg-rose-200 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reintentar
                </button>
              </div>
            ) : teachersLoading ? (
              <Skeleton className="h-24 w-full rounded-3xl" />
            ) : pendingTeachers?.length === 0 ? (
              <Card className="p-16 text-center bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-3xl shadow-none">
                <p className="text-slate-500 font-bold text-lg">No hay profesores pendientes de validación</p>
              </Card>
            ) : (
              <>
                {pendingTeachers?.slice(0, 5).map((t: Teacher) => (
                  <Card key={t.id} className="p-5 border-slate-100 shadow-sm rounded-2xl flex items-center justify-between">
                    <div>
                      <p className="font-bold text-slate-800">{t.name} {t.surname}</p>
                      <p className="text-xs text-slate-400">@{t.username}</p>
                    </div>
                    <Badge variant="warning">Pendiente</Badge>
                  </Card>
                ))}
                <Link
                  href="/admin/teachers"
                  className="flex items-center justify-center gap-1.5 text-sm font-bold text-pink-600 hover:text-pink-700 py-3"
                >
                  Ir a revisar todos los profesores <ChevronRight className="w-4 h-4" />
                </Link>
              </>
            )}
          </div>
        )}

        {/* Tab 4: History */}
        {activeTab === 'history' && (
          <div className="space-y-4 pt-2">
            {historyError ? (
              <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl px-4 py-3.5 flex items-center gap-3 flex-wrap">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span className="text-xs font-bold flex-1">No se pudo cargar el historial de pagos.</span>
                <button
                  onClick={() => refetchHistory()}
                  className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-100 hover:bg-rose-200 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reintentar
                </button>
              </div>
            ) : historyLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full rounded-3xl" />)}
              </div>
            ) : history?.length === 0 ? (
              <Card className="p-16 text-center bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-3xl shadow-none">
                <div className="text-5xl mb-4 opacity-60">🕒</div>
                <p className="text-slate-500 font-bold text-lg">Sin historial todavía</p>
              </Card>
            ) : (
              history?.map((p: PaymentHistoryItem) => {
                const badge = TYPE_BADGE[p.payment_type] || {
                  label: () => p.payment_type || "Pago",
                  cls: "bg-slate-100 text-slate-700 border-slate-200"
                }

                return (
                  <Card key={p.payment_id} hover className="p-6 border-slate-100 shadow-sm rounded-3xl">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className={`text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full border ${badge.cls}`}>
                          {badge.label(p)}
                        </span>
                        <div className="flex items-center gap-1.5 font-bold text-slate-800">
                          <User className="w-4 h-4 text-slate-400" />
                          <span>{p.student_name}</span>
                          <span className="text-xs text-slate-400 font-normal">(@{p.student_username})</span>
                        </div>
                      </div>
                      <span className="text-pink-600 font-black text-xl bg-pink-50 px-4 py-1.5 rounded-2xl w-fit">
                        ${p.amount.toFixed(2)}
                      </span>
                    </div>

                    {/* Detalle adicional */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs text-slate-500 mb-4 bg-slate-50/70 p-3 rounded-2xl border border-slate-100">
                      {p.package_name && (
                        <div className="flex items-center gap-1.5">
                          <PackageIcon className="w-3.5 h-3.5 text-slate-400" />
                          <span>Paquete: <strong className="text-slate-700">{p.package_name}</strong></span>
                        </div>
                      )}
                      {p.teacher_name && (
                        <div>
                          Profesor: <strong className="text-slate-700">{p.teacher_name}</strong>
                        </div>
                      )}
                      {p.payment_method_label && (
                        <div>
                          Método: <strong className="text-slate-700">{p.payment_method_label}</strong>
                        </div>
                      )}
                      {p.transaction_reference && (
                        <div className="font-mono text-slate-400">
                          Ref: <strong className="text-slate-600">{p.transaction_reference}</strong>
                        </div>
                      )}
                      {p.submitted_at && (
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>Solicitado: <strong className="text-slate-700">{new Date(p.submitted_at).toLocaleString('es')}</strong></span>
                        </div>
                      )}
                    </div>

                    <RefundDestinationInfo info={p.refund_payment_info} />

                    {/* Estado / Historial Badge */}
                    <div>
                      {p.status === 'approved' ? (
                        <div className="flex items-center gap-2">
                          <Badge variant="success">Aprobado</Badge>
                          {p.validated_at && (
                            <span className="text-xs text-slate-400">
                              {new Date(p.validated_at).toLocaleString('es')}
                            </span>
                          )}
                        </div>
                      ) : p.status === 'rejected' ? (
                        <div className="space-y-1">
                          <Badge variant="danger">Rechazado</Badge>
                          {p.rejection_reason && (
                            <p className="text-xs text-slate-500">{p.rejection_reason}</p>
                          )}
                        </div>
                      ) : (
                        <Badge variant="warning">{p.status}</Badge>
                      )}
                    </div>
                  </Card>
                )
              })
            )}
            <LoadMoreButton hasMore={historyHasMore} loading={historyLoadingMore} onClick={loadMoreHistory} />
          </div>
        )}
      </div>

      <RejectReasonModal
        open={!!rejectTarget}
        title={rejectTarget?.kind === 'withdrawal' ? 'Rechazar retiro' : 'Rechazar pago'}
        description={rejectTarget ? `Vas a rechazar: ${rejectTarget.label}` : undefined}
        loading={rejecting}
        onClose={() => { if (!rejecting) setRejectTarget(null) }}
        onConfirm={handleConfirmReject}
      />

      <ConfirmModal
        open={!!approveTarget}
        title="Confirmar pago"
        description={approveTarget ? `Vas a aprobar ${approveTarget.student_name ? approveTarget.student_name + ' · ' : ''}$${Number(approveTarget.amount).toFixed(2)}. Esto activa el paquete y mueve el saldo del profesor.` : ''}
        confirmLabel="Aprobar pago"
        loading={validating === approveTarget?.payment_id}
        onClose={() => { if (validating === null) setApproveTarget(null) }}
        onConfirm={async () => { if (approveTarget) await handleApprove(approveTarget) }}
      />

      <FullScreenModal
        open={!!payTarget}
        onClose={() => { if (processing === null) setPayTarget(null) }}
        title="Marcar retiro como pagado"
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => setPayTarget(null)}
              disabled={processing !== null}
              className="flex-1 py-3 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <Button
              variant="primary"
              loading={processing === payTarget?.id}
              onClick={() => payTarget && handleProcessWithdrawal(payTarget.id, payReference)}
              className="flex-1 justify-center"
            >
              Confirmar pago
            </Button>
          </div>
        }
      >
        {payTarget && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Confirmas que ya transferiste <strong>${payTarget.amount.toFixed(2)}</strong> a <strong>{payTarget.teacher_name}</strong>.
            </p>
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3">{payTarget.destination_details}</p>
            <div>
              <label htmlFor="withdraw-reference" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                Referencia de la transferencia (opcional)
              </label>
              <input
                id="withdraw-reference"
                value={payReference}
                onChange={(e) => setPayReference(e.target.value)}
                placeholder="Nº de operación, hash, etc."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 p-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-pink-200"
              />
            </div>
          </div>
        )}
      </FullScreenModal>

      <ConfirmModal
        open={!!grantApprove}
        title="Aprobar paquete gratis"
        description={grantApprove ? `Vas a dar «${grantApprove.package_name ?? 'el paquete'}» gratis a ${grantApprove.student_name ?? 'este alumno'}. Queda registrado en la auditoría.` : ''}
        confirmLabel="Aprobar"
        loading={grantBusy}
        onClose={() => { if (!grantBusy) setGrantApprove(null) }}
        onConfirm={async () => { if (grantApprove) await resolveGrant(grantApprove, 'approve') }}
      />
      <RejectReasonModal
        open={!!grantReject}
        title="Rechazar solicitud de paquete gratis"
        description={grantReject ? `${grantReject.teacher_name} → ${grantReject.student_name}` : undefined}
        loading={grantBusy}
        onClose={() => { if (!grantBusy) setGrantReject(null) }}
        onConfirm={(reason) => grantReject ? resolveGrant(grantReject, 'reject', reason) : undefined}
      />

      <ChipiWidget screenName="admin_payments" />
    </>
  )
}