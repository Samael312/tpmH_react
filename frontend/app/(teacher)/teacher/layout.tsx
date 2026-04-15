'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/store/authStore'

const navItems = [
  {
    href: '/teacher/dashboard',
    label: 'Mis Clases',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    href: '/teacher/availability',
    label: 'Disponibilidad',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </svg>
    ),
  },
  {
    href: '/teacher/materials',
    label: 'Materiales',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.625-12.125L15 4.875 12.375 7.5M8.625 1.5L6 4.125l2.625 2.625" />
      </svg>
    ),
  },
  {
    href: '/teacher/homework',
    label: 'Tareas',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
      </svg>
    ),
  },
  {
    href: '/teacher/wallet',
    label: 'Ganancias',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
      </svg>
    ),
  },
  {
    href: '/teacher/profile',
    label: 'Mi Perfil',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.963-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

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
    if (user && !['teacher', 'professor_admin'].includes(user.role)) {
      router.push('/login')
    }
  }, [user])

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">

      {/* Sidebar */}
      <aside className={`
        flex flex-col bg-white border-r border-pink-100 shadow-xl shadow-pink-500/5
        transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] flex-shrink-0
        ${collapsed ? 'w-20' : 'w-64'}
      `}>

        {/* Logo Section */}
        <div className="flex items-center gap-3 px-5 py-8">
          <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-rose-400 rounded-2xl flex-shrink-0
                          flex items-center justify-center shadow-lg shadow-pink-200 transform hover:rotate-12 transition-transform">
            <span className="text-white text-xl font-black">T</span>
          </div>
          {!collapsed && (
            <div className="animate-fade-in">
              <span className="font-display text-lg font-bold
                               text-slate-800 tracking-tight block leading-none">
                TPMH
              </span>
              <span className="text-[11px] font-bold text-pink-400 uppercase tracking-widest">
                Teacher Hub
              </span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 space-y-2 px-3 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => {
            const isActive = pathname === item.href ||
              pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-2xl
                  text-sm transition-all duration-300 group
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
                  <span className="font-semibold tracking-tight">{item.label}</span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* User & Footer */}
        <div className="p-4 border-t border-slate-50 space-y-2">
          {!collapsed && user && (
            <div className="px-4 py-3 mb-2 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-slate-800 text-xs font-bold truncate">
                {user.name}
              </p>
              <p className="text-pink-400 text-[10px] font-medium uppercase tracking-tighter">@{user.username}</p>
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 className="w-5 h-5 flex-shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            {!collapsed && <span>Cerrar Sesión</span>}
          </button>
        </div>
      </aside>

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
