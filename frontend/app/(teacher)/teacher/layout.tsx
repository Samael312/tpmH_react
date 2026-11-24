'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import NavBar from '@/components/layout/NavBar'
import DashboardTopbar from '@/components/layout/DashboardTopbar'
import ChatWidget from '@/components/chat/ChatWidget'
import api from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import { fetchMe } from '@/lib/me'
import { usePlatformConfig } from '@/hooks/useStudentData'
import { useChatSocketBootstrap } from '@/hooks/useChat'
import VerifyEmailBanner from '@/components/layout/VerifyEmailBanner'

const FULLSCREEN_ROUTES = ['/teacher/onboarding']

export default function TeacherLayout({
  children
}: {
  children: React.ReactNode
}) {
  const router   = useRouter()
  const qc       = useQueryClient()
  const pathname = usePathname()
  const { user, setUser, hasHydrated } = useAuthStore()
  const { config: platformConfig } = usePlatformConfig()

  const isFullscreen = FULLSCREEN_ROUTES.some(r => pathname.startsWith(r))

  // N3: misma conexión WS global que en el layout de student — ver
  // store/chatStore.ts.
  useChatSocketBootstrap(!!user && platformConfig?.chat_enabled === true)

  // Bloquea el render hasta confirmar que el onboarding está completo
  const [ready, setReady] = useState(isFullscreen)

  const userRef = useRef(user)
  useEffect(() => {
    userRef.current = user
  }, [user])

  // El onboarding se verifica contra la API UNA vez por sesión del layout. Antes se repetía en cada cambio de
  // ruta (2 peticiones, /users/me y el perfil, por cada clic del menú).
  const verifiedRef = useRef(false)
  const hasUser = !!user

  useEffect(() => {
    if (!hasHydrated) return

    const currentUser = userRef.current

    if (!currentUser) {
      verifiedRef.current = false
      // SEC-05 / UX-01: sesión por cookie HttpOnly pero sin `user` en localStorage -> se recupera de /users/me.
      fetchMe(qc).then((me) => setUser({ ...me })).catch(() => router.push('/login'))
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

    // Ya verificado en esta sesión: `ready` sigue en true (el layout no se desmonta al navegar).
    if (verifiedRef.current) return

    Promise.all([
    fetchMe(qc).then((data) => ({ data })),
    api.get('/teachers/me/profile').catch(() => ({ data: {} })),
  ]).then(([meRes, tpRes]) => {
    const data = meRes.data;
    const teacherData = tpRes.data;
    const done = data.onboarding_completed ?? false;
    const latestUser = userRef.current;
    if (!latestUser) return;

    setUser({
      ...latestUser,
      id: data.id ?? latestUser.id, // el login no trae el id; el chat lo necesita (antes salía del JWT)
      onboarding_completed: done,
      tour_completed: data.tour_completed ?? latestUser.tour_completed, // guía del menú (undefined = no mostrar)
      timezone: teacherData?.timezone ?? latestUser.timezone,
    });

    if (!done) {
      router.replace('/teacher/onboarding');
    } else {
      verifiedRef.current = true;
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
}, [pathname, hasHydrated, hasUser, router, setUser, qc]);

  // Si el store ya no tiene user/token (p.ej. logout en curso), no renderizar
  // el dashboard con datos nulos: mostrar spinner mientras se redirige.
  if (hasHydrated && !user && !isFullscreen) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin" />
      </div>
    )
  }

  // Mientras se verifica la API, mostrar spinner en lugar del dashboard.
  // El `&& !isFullscreen` es necesario: si el guard nos hizo `replace()`
  // hacia /teacher/onboarding *después* de montar en otra ruta (ready
  // seguía en `false` de ese montaje), sin este resguardo la pantalla de
  // onboarding se queda esperando un `setReady(true)` que nunca llega,
  // porque la rama del effect para onboarding hace `return` temprano sin
  // setearlo. Con esto, isFullscreen manda apenas la ruta cambia.
  if (!ready && !isFullscreen) {
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
      {/* En /teacher/chat el widget flotante sería redundante (ya estás
          en la pantalla completa del chat) — ahí solo va el ChipiWidget,
          que cada página monta por su cuenta. */}
      {!pathname.startsWith('/teacher/chat') && <ChatWidget />}

      <main className="flex-1 flex flex-col min-w-0 bg-slate-50 pt-14 pb-20 md:pt-0 md:pb-0">
        <DashboardTopbar variant="teacher" />

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="max-w-7xl mx-auto">
            <VerifyEmailBanner />
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}