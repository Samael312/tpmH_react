'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'

interface NavItem {
  href:  string
  label: string
}

interface AppHeaderProps {
  navItems: NavItem[]
  role?: 'teacher' | 'student'
}

export default function AppHeader({ navItems, role }: AppHeaderProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const { user, logout } = useAuthStore()

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  return (
    <header className="sticky top-0 z-50 bg-primary shadow-md">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center
                      justify-between">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="white" className="w-7 h-7">
            <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z"/>
          </svg>
          <span className="text-white font-display font-bold text-lg
                           tracking-wide">
            TuProfeMaria
          </span>
        </Link>

        {/* Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map(item => {
            const isActive = pathname === item.href ||
              pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  px-4 py-2 text-sm font-semibold rounded-lg
                  transition-all duration-150
                  ${isActive
                    ? 'bg-white/20 text-white'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                  }
                `}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Derecha */}
        <div className="flex items-center gap-2">
          {user && (
            <span className="text-white/70 text-sm hidden md:block">
              {user.name}
            </span>
          )}
          <button
            onClick={handleLogout}
            className="w-9 h-9 flex items-center justify-center
                       bg-white/15 rounded-full hover:bg-white/25
                       transition-colors"
            title="Cerrar sesión"
          >
            <svg viewBox="0 0 20 20" fill="white" className="w-4 h-4">
              <path fillRule="evenodd"
                d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z"
                clipRule="evenodd"/>
            </svg>
          </button>
        </div>
      </div>
    </header>
  )
}