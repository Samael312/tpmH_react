'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import NavBar from '@/components/layout/NavBar'
import api from '@/lib/api'

const FULLSCREEN_ROUTES = ['/teacher/onboarding']

export default function TeacherLayout({
  children
}: {
  children: React.ReactNode
}) {
  const router   = useRouter()
  const pathname = usePathname()
  const { user, token, setUser } = useAuthStore()

  const isFullscreen = FULLSCREEN_ROUTES.some(r => pathname.startsWith(r))

  // Bloquea el render hasta confirmar que el onboarding está completo
  const [ready, setReady] = useState(isFullscreen)

  useEffect(() => {
    if (!user || !token) {
      router.push('/login')
      return
    }

    if (!['teacher', 'teacher_admin'].includes(user.role)) {
      router.push('/login')
      return
    }

    // En el onboarding no hace falta verificar nada más
    if (pathname.startsWith('/teacher/onboarding')) {
      setReady(true)
      return
    }

    // Consultar la API para obtener el valor real de onboarding_completed
    api.get('/users/me')
      .then(res => {
        const data = res.data
        const done = data.onboarding_completed ?? false

        setUser({
          ...user,
          onboarding_completed: done,
          timezone: data.teacher_profile?.timezone ?? data.timezone ?? user.timezone,
        })

        if (!done) {
          // Reemplazar en el historial para que el botón atrás no vuelva al dashboard
          router.replace('/teacher/onboarding')
        } else {
          setReady(true)
        }
      })
      .catch(() => {
        // Fallback: usar el valor del store
        if (!user.onboarding_completed) {
          router.replace('/teacher/onboarding')
        } else {
          setReady(true)
        }
      })
  }, [pathname])

  // Mientras se verifica la API, mostrar spinner en lugar del dashboard
  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin" />
      </div>
    )
  }

  // Onboarding: sin sidebar ni header
  if (isFullscreen) {
    return <>{children}</>
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      <NavBar />

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
              <span className="text-[10px] text-pink-400 font-medium italic leading-none">
                Profesor Verificado
              </span>
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