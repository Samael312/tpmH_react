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
    up:      'text-emerald-500 bg-emerald-50',
    down:    'text-rose-500 bg-rose-50',
    neutral: 'text-slate-400 bg-slate-50',
    warning: 'text-amber-500 bg-amber-50',
  }

  return (
    <div className="bg-white border border-slate-100 rounded-[2rem] p-6
                    hover:shadow-xl hover:shadow-pink-500/5 transition-all duration-300 group">
      <div className="flex items-center justify-between mb-4">
        <div className="p-3 bg-pink-50 rounded-2xl group-hover:bg-pink-500 group-hover:text-white transition-colors duration-300 text-pink-500">
          {icon}
        </div>
        {change && (
          <span className={`text-[10px] font-bold px-2 py-1 rounded-lg ${changeColors[changeType]}`}>
            {change}
          </span>
        )}
      </div>
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.15em] mb-1">
          {label}
        </p>
        <h3 className="text-3xl font-black text-slate-800 tracking-tighter">
          {value}
        </h3>
      </div>
    </div>
  )
}