'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import NavBar from '@/components/layout/NavBar'
import DashboardTopbar from '@/components/layout/DashboardTopbar'
import api from '@/lib/api'

const FULLSCREEN_ROUTES = ['/teacher/onboarding']

export default function TeacherLayout({
  children
}: {
  children: React.ReactNode
}) {
  const router   = useRouter()
  const pathname = usePathname()
  const { user, token, setUser, hasHydrated } = useAuthStore()

  const isFullscreen = FULLSCREEN_ROUTES.some(r => pathname.startsWith(r))

  // Bloquea el render hasta confirmar que el onboarding está completo
  const [ready, setReady] = useState(isFullscreen)

  const userRef = useRef(user)
  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    if (!hasHydrated) return

    const currentUser = userRef.current

    if (!currentUser || !token) {
      router.push('/login')
      return
    }

    if (!['teacher', 'teacher_admin'].includes(currentUser.role)) {
      router.push('/login')
      return
    }

    // En el onboarding no hace falta verificar nada más
    if (pathname.startsWith('/teacher/onboarding')) {
      return
    }

    Promise.all([
    api.get('/users/me'),
    api.get('/teachers/me/profile').catch(() => ({ data: {} })),
  ]).then(([meRes, tpRes]) => {
    const data = meRes.data;
    const teacherData = tpRes.data;
    const done = data.onboarding_completed ?? false;
    const latestUser = userRef.current;
    if (!latestUser) return;

    setUser({
      ...latestUser,
      onboarding_completed: done,
      timezone: teacherData?.timezone ?? latestUser.timezone,
    });

    if (!done) {
      router.replace('/teacher/onboarding');
    } else {
      setReady(true);
    }
  }).catch(() => {
    const latestUser = userRef.current;
    if (!latestUser?.onboarding_completed) {
      router.replace('/teacher/onboarding');
    } else {
      setReady(true);
    }
  });
}, [pathname, hasHydrated, token, router, setUser]);

  // Si el store ya no tiene user/token (p.ej. logout en curso), no renderizar
  // el dashboard con datos nulos: mostrar spinner mientras se redirige.
  if (hasHydrated && (!user || !token) && !isFullscreen) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin" />
      </div>
    )
  }

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

      <main className="flex-1 flex flex-col min-w-0 bg-slate-50 pt-14 pb-20 md:pt-0 md:pb-0">
        <DashboardTopbar variant="teacher" />

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}