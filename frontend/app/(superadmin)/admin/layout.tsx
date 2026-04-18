'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/store/authStore'
import NavBar from '@/components/layout/NavBar'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, logout } = useAuthStore()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (!user || user.role !== 'superadmin') {
      router.push('/login')
    }
  }, [user])

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">

      <NavBar />
        

      {/* ─── Main content ─────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-50">
        
        {/* Topbar */}
        <header className="h-20 sticky top-0 z-10 border-b border-slate-200/50
                           bg-white/80 backdrop-blur-md px-8
                           flex items-center justify-between shadow-sm shadow-slate-100/50">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-pink-500 animate-pulse"/>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] hidden sm:block">
              Sistema de Administración
            </span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end">
              <span className="text-xs font-bold text-slate-700">{user?.name}</span>
              <span className="text-[10px] text-pink-400 font-bold uppercase tracking-widest leading-none">Superadmin</span>
            </div>
            <div className="w-10 h-10 rounded-[10px] bg-gradient-to-br from-pink-100 to-rose-50 border border-pink-200 shadow-inner flex items-center justify-center text-pink-600 font-black text-lg">
              {user?.name?.[0] || 'A'}
            </div>
          </div>
        </header>

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