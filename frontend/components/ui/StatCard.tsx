interface StatCardProps {
  label: string
  value: string | number
  change?: string
  changeType?: 'up' | 'down' | 'neutral' | 'warning'
  icon?: React.ReactNode
}

export default function StatCard({
  label, value, change, changeType = 'neutral', icon
}: StatCardProps) {
  const changeColors = {
    up:      'text-emerald-500 bg-emerald-50/80 border border-emerald-100/50',
    down:    'text-rose-500 bg-rose-50/80 border border-rose-100/50',
    neutral: 'text-slate-500 bg-slate-50 border border-slate-100/50',
    warning: 'text-amber-500 bg-amber-50/80 border border-amber-100/50',
  }

  return (
    <div className="relative bg-white/80 backdrop-blur-xl border border-slate-200/80 rounded-[2rem] p-6
                    shadow-[0_10px_30px_-10px_rgba(0,0,0,0.03)]
                    hover:shadow-[0_20px_40px_-15px_rgba(236,72,153,0.15),0_0_20px_rgba(236,72,153,0.05)]
                    hover:border-pink-500/20 transition-all duration-500 group overflow-hidden">
      
      {/* Subtle top gradient highlight for glassmorphism effect */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-80" />

      <div className="flex items-center justify-between mb-4">
        {/* Icon container with refined shadow and multi-layer depth */}
        <div className="p-3 bg-pink-50/80 backdrop-blur-sm rounded-2xl 
                        shadow-sm shadow-pink-500/5
                        group-hover:bg-pink-500 group-hover:text-white 
                        group-hover:shadow-md group-hover:shadow-pink-500/25 
                        transition-all duration-300 text-pink-500">
          {icon}
        </div>

        {/* Enhanced badge */}
        {change && (
          <span className={`text-[11px] font-extrabold px-2.5 py-1 rounded-xl shadow-2xs tracking-wide ${changeColors[changeType]}`}>
            {change}
          </span>
        )}
      </div>

      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.15em] mb-1.5 group-hover:text-slate-500 transition-colors duration-300">
          {label}
        </p>
        <h3 className="text-3xl font-black text-slate-800 tracking-tight drop-shadow-2xs">
          {value}
        </h3>
      </div>
    </div>
  )
}