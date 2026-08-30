'use client'

import { useAuthStore } from '@/store/authStore'

export type DashboardTopbarVariant = 'student' | 'teacher' | 'admin'

interface VariantConfig {
  label: string
  labelClass: string
  badge: 'live' | 'pulse'
  border: string
  roleLabel: string
  roleLabelClass: string
  avatar: 'circle' | 'squircle'
}

const VARIANT_CONFIG: Record<DashboardTopbarVariant, VariantConfig> = {
  student: {
    label: 'Dashboard',
    labelClass: 'text-xs text-slate-400 font-bold uppercase tracking-[0.2em]',
    badge: 'live',
    border: 'border-pink-100/50',
    roleLabel: 'Estudiante',
    roleLabelClass: 'text-[10px] text-pink-400 font-medium italic leading-none',
    avatar: 'circle',
  },
  teacher: {
    label: 'Dashboard',
    labelClass: 'text-xs text-slate-400 font-bold uppercase tracking-[0.2em]',
    badge: 'live',
    border: 'border-pink-100/50',
    roleLabel: 'Profesor Verificado',
    roleLabelClass: 'text-[10px] text-pink-400 font-medium italic leading-none',
    avatar: 'circle',
  },
  admin: {
    label: 'Sistema de Administración',
    labelClass: 'text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] hidden sm:block',
    badge: 'pulse',
    border: 'border-slate-200/50',
    roleLabel: 'Superadmin',
    roleLabelClass: 'text-[10px] text-pink-400 font-bold uppercase tracking-widest leading-none',
    avatar: 'squircle',
  },
}

/**
 * Topbar desktop compartido entre los 3 layouts (student/teacher/admin).
 * Oculto en mobile: en mobile ya existe MobileTopBar dentro de NavBar.tsx
 * (título de página + refresh vía contexto).
 */
export default function DashboardTopbar({ variant }: { variant: DashboardTopbarVariant }) {
  const { user } = useAuthStore()
  const cfg = VARIANT_CONFIG[variant]

  return (
    <header
      className={`hidden md:flex h-20 sticky top-0 z-10 border-b ${cfg.border}
                 bg-white/80 backdrop-blur-md px-8
                 items-center justify-between shadow-sm shadow-slate-100/50`}
    >
      <div className="flex items-center gap-3">
        {cfg.badge === 'live' ? (
          <span className="text-[10px] font-black text-white bg-pink-500 px-2 py-0.5 rounded-full uppercase tracking-tighter shadow-sm shadow-pink-200">
            Live
          </span>
        ) : (
          <div className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
        )}
        <div className={cfg.labelClass}>{cfg.label}</div>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden md:flex flex-col items-end">
          <span className="text-xs font-bold text-slate-700">{user?.name}</span>
          <span className={cfg.roleLabelClass}>{cfg.roleLabel}</span>
        </div>
        {cfg.avatar === 'circle' ? (
          <div className="w-10 h-10 rounded-full bg-pink-100 border-2 border-white shadow-sm flex items-center justify-center text-pink-500 font-bold">
            {user?.name?.charAt(0)}
          </div>
        ) : (
          <div className="w-10 h-10 rounded-[10px] bg-gradient-to-br from-pink-100 to-rose-50 border border-pink-200 shadow-inner flex items-center justify-center text-pink-600 font-black text-lg">
            {user?.name?.[0] || 'A'}
          </div>
        )}
      </div>
    </header>
  )
}
