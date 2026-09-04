'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import NavBar from '@/components/layout/NavBar'
import DashboardTopbar from '@/components/layout/DashboardTopbar'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { user, hasHydrated } = useAuthStore()

  useEffect(() => {
    if (!hasHydrated) return
    if (!user || !["superadmin", "teacher_admin"].includes(user.role)) {
      router.push('/login')
    }
  }, [user, hasHydrated, router])

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">

      <NavBar />
        

      {/* ─── Main content ─────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-50 pt-14 pb-20 md:pt-0 md:pb-0">
        
        {/* Topbar */}
        <DashboardTopbar variant="admin" />

        {/* Page content */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
          <div className="max-w-[1400px] mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}