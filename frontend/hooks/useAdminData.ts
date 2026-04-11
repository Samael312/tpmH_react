import { useState, useEffect, useCallback } from 'react'
import api from '@/lib/api'

interface PlatformStats {
  total_users: number
  total_students: number
  total_teachers: number
  total_teachers_pending: number
  total_teachers_approved: number
  total_classes: number
  classes_this_month: number
  classes_completed: number
  classes_cancelled: number
  total_revenue: number
  total_paid_to_teachers: number
  total_platform_earnings: number
  pending_withdrawals: number
  new_users_this_week: number
  new_classes_this_week: number
}

interface PendingPayment {
  payment_id: number
  class_id: number
  student_name: string
  student_username: string
  amount: number
  payment_method: string
  transaction_id: string
  receipt_url: string
  class_start_utc: string
  submitted_at: string
}

interface Teacher {
  id: number
  username: string
  name: string
  surname: string
  email: string
  status: string
  commission_rate: number
  balance: number
  total_classes: number
  total_students: number
  created_at: string
}

interface Student {
  id: number
  username: string
  name: string
  surname: string
  email: string
  role: string
  is_active: boolean
  is_verified: boolean
  created_at: string
}

interface PaymentRecord {
  id: number
  class_id: number | null
  student_id: number
  teacher_id: number
  amount_total: number
  amount_teacher: number
  amount_platform: number
  payment_method: string
  receipt_url: string | null
  transaction_id: string | null
  status: string
  created_at: string
  validated_at: string | null
}

interface WithdrawalRecord {
  id: number
  teacher_id: number
  teacher_username: string
  teacher_name: string
  amount: number
  status: string
  created_at: string
}

export function useStudents(search?: string) {
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({ role: 'student' })
      if (search) params.append('search', search)
      const res = await api.get(`/admin/users?${params}`)
      setStudents(res.data)
      setTotal(res.data.length)
    } catch { }
    finally { setLoading(false) }
  }, [search])

  useEffect(() => { fetch() }, [fetch])
  return { students, loading, total, refetch: fetch }
}

export function useWithdrawals() {
  const [withdrawals, setWithdrawals] = useState<WithdrawalRecord[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/admin/withdrawals/pending')
      setWithdrawals(res.data)
    } catch { }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetch() }, [fetch])
  return { withdrawals, loading, refetch: fetch }
}

export function useAdminStats() {
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/admin/stats')
      setStats(res.data)
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Error cargando métricas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])
  return { stats, loading, error, refetch: fetch }
}

export function usePendingPayments() {
  const [payments, setPayments] = useState<PendingPayment[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/payments/pending-review')
      setPayments(res.data)
    } catch { } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])
  return { payments, loading, refetch: fetch }
}

export function useTeachers(statusFilter?: string) {
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const params = statusFilter ? `?status_filter=${statusFilter}` : ''
      const res = await api.get(`/admin/teachers${params}`)
      setTeachers(res.data)
    } catch { } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { fetch() }, [fetch])
  return { teachers, loading, refetch: fetch }
}