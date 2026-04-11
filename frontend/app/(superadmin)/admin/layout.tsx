'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/store/authStore'

const navItems = [
  {
    href: '/admin/dashboard',
    label: 'Dashboard',
    exact: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: '/admin/teachers',
    label: 'Profesores',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    href: '/admin/students',
    label: 'Estudiantes',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    href: '/admin/payments',
    label: 'Pagos',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
  },
  {
    href: '/admin/settings',
    label: 'Configuración',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

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

      {/* ─── Sidebar ─────────────────────────────────────── */}
      <aside className={`
        flex flex-col bg-white border-r border-slate-100 shadow-xl shadow-slate-200/20
        transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] flex-shrink-0 z-20
        ${collapsed ? 'w-20' : 'w-64'}
      `}>

        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-8">
          <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-rose-400 rounded-2xl flex-shrink-0
                          flex items-center justify-center shadow-lg shadow-pink-200 transform hover:rotate-12 transition-transform">
            <span className="text-white text-xl font-black">T</span>
          </div>
          {!collapsed && (
            <div className="animate-fade-in flex flex-col justify-center">
              <span className="font-display text-lg font-bold text-slate-800 tracking-tight leading-none">
                TPMH
              </span>
              <span className="text-[10px] font-black text-pink-400 uppercase tracking-widest mt-1">
                Admin Panel
              </span>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 space-y-2 px-3 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => {
           const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-2xl
                  text-sm font-bold transition-all duration-300 group
                  ${isActive
                    ? 'bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-md shadow-pink-100'
                    : 'text-slate-500 hover:text-pink-500 hover:bg-pink-50/50'
                  }
                `}
              >
                <span className={`flex-shrink-0 transition-transform duration-300 group-hover:scale-110
                  ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-pink-400'}`}>
                  {item.icon}
                </span>
                {!collapsed && (
                  <span className="tracking-tight">{item.label}</span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Footer del sidebar */}
        <div className="p-4 border-t border-slate-50 space-y-2">
          {!collapsed && user && (
            <div className="px-4 py-3 mb-2 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-slate-800 text-xs font-bold truncate">
                {user.name}
              </p>
              <p className="text-pink-400 text-[10px] font-medium uppercase tracking-tighter mt-0.5">
                @{user.username}
              </p>
            </div>
          )}
          
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center gap-3 px-4 py-2.5
                       text-slate-400 hover:text-pink-500 rounded-xl
                       hover:bg-pink-50 transition-all duration-200 text-sm font-medium"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" 
                 className={`w-5 h-5 flex-shrink-0 transition-transform duration-500 ${collapsed ? 'rotate-180' : ''}`}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
            {!collapsed && <span>Contraer</span>}
          </button>

          <button
            onClick={() => { logout(); router.push('/login') }}
            className="w-full flex items-center gap-3 px-4 py-2.5
                       text-slate-400 hover:text-rose-500 rounded-xl
                       hover:bg-rose-50 transition-all duration-200 text-sm font-medium"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 flex-shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            {!collapsed && <span>Cerrar sesión</span>}
          </button>
        </div>
      </aside>

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