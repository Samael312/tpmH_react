'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/store/authStore'
import NavBar from '@/components/layout/NavBar'


export default function TeacherLayout({
  children
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, logout } = useAuthStore()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (user && !['teacher', 'teacher_admin'].includes(user.role)) {
      router.push('/login')
    }
  }, [user])

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">

      <NavBar />
      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-50">
        <header className="h-20 border-b border-pink-100/50 bg-white/80 backdrop-blur-md px-8
                           flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-black text-white bg-pink-500 px-2 py-0.5 rounded-full uppercase tracking-tighter shadow-sm shadow-pink-200">
              Live
            </span>
            <div className="text-xs text-slate-400 font-bold uppercase tracking-[0.2em]">
              Dashboard
            </div>
          </div>
          
          <div className="flex items-center gap-4">
             <div className="hidden md:flex flex-col items-end">
                <span className="text-xs font-bold text-slate-700">{user?.name}</span>
                <span className="text-[10px] text-pink-400 font-medium italic leading-none">Profesor Verificado</span>
             </div>
             <div className="w-10 h-10 rounded-full bg-pink-100 border-2 border-white shadow-sm flex items-center justify-center text-pink-500 font-bold">
               {user?.name?.charAt(0)}
             </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
