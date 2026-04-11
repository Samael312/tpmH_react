type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'gold' | 'pink'

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}

const variants: Record<BadgeVariant, string> = {
  success: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  warning: 'bg-amber-50 text-amber-600 border-amber-100',
  danger:  'bg-rose-50 text-rose-600 border-rose-100',
  info:    'bg-sky-50 text-sky-600 border-sky-100',
  neutral: 'bg-slate-100 text-slate-500 border-slate-200',
  gold:    'bg-yellow-50 text-yellow-700 border-yellow-200',
  pink:    'bg-pink-50 text-pink-600 border-pink-100',
}

export default function Badge({ children, variant = 'neutral', className = '' }: BadgeProps) {
  return (
    <span className={`
      inline-flex items-center px-3 py-1
      text-[10px] font-black uppercase tracking-wider border rounded-full
      ${variants[variant]} ${className}
    `}>
      {children}
    </span>
  )
}