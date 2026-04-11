'use client'

import { useState } from 'react'
import { useTeacherClasses, useWallet } from '@/hooks/useTeacherData'
import ClassCard from '@/components/teacher/ClassCard'
import StatCard from '@/components/ui/StatCard'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function getWeekDates() {
  const today = new Date()
  const monday = new Date(today)
  monday.setUTCDate(today.getUTCDate() - today.getUTCDay() + 1)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setUTCDate(monday.getUTCDate() + i)
    return d
  })
}

export default function TeacherDashboard() {
  const weekDates = getWeekDates()
  const today = new Date()
  const [selectedDate, setSelectedDate] = useState(
    today.toISOString().split('T')[0]
  )
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming')

  const { classes, loading, stats, refetch } = useTeacherClasses({
    date: tab === 'upcoming' ? selectedDate : undefined,
    includeHistory: tab === 'history',
  })
  const { wallet } = useWallet()

  const todayClasses = classes.filter(c => {
    const d = new Date(c.start_time_utc).toISOString().split('T')[0]
    return d === today.toISOString().split('T')[0]
  })

  return (
    <div className="space-y-8 animate-fade-up bg-white min-h-screen p-6 rounded-3xl">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold text-slate-800 mb-2 tracking-tight">
            Mis Clases
          </h1>
          <p className="text-sm text-slate-500 font-medium">
            Gestiona tu agenda y el estado de cada sesión
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4
                      animate-fade-up animate-fade-up-delay-1">
        <StatCard
          label="Próximas"
          value={stats.upcoming}
          icon={
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-pink-500">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
            </svg>
          }
        />
        <StatCard
          label="Completadas"
          value={stats.completed}
          changeType="up"
          icon={
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-rose-500">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
            </svg>
          }
        />
        <StatCard
          label="Balance"
          value={`$${wallet?.available_balance.toFixed(2) || '0.00'}`}
          changeType="up"
          icon={
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-pink-500">
              <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z"/>
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd"/>
            </svg>
          }
        />
        <StatCard
          label="Total ganado"
          value={`$${wallet?.total_earned.toFixed(2) || '0.00'}`}
          icon={
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-rose-400">
              <path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11 4a1 1 0 10-2 0v4a1 1 0 102 0V7zm-3 1a1 1 0 10-2 0v3a1 1 0 102 0V8zM8 9a1 1 0 00-2 0v2a1 1 0 102 0V9z" clipRule="evenodd"/>
            </svg>
          }
        />
      </div>

      {/* Selector de semana */}
      <div className="animate-fade-up animate-fade-up-delay-2 bg-slate-50/50 p-4 rounded-2xl border border-pink-50">
        <p className="text-xs text-pink-400 uppercase tracking-widest font-bold mb-3">
          Semana actual
        </p>
        <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
          {weekDates.map((date, i) => {
            const dateStr = date.toISOString().split('T')[0]
            const isToday = dateStr === today.toISOString().split('T')[0]
            const isSelected = dateStr === selectedDate

            return (
              <button
                key={dateStr}
                onClick={() => {
                  setSelectedDate(dateStr)
                  setTab('upcoming')
                }}
                className={`
                  flex-shrink-0 flex flex-col items-center px-4 py-3
                  rounded-2xl text-xs transition-all duration-300 shadow-sm
                  ${isSelected
                    ? 'bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-pink-200 shadow-md scale-105 transform'
                    : isToday
                      ? 'bg-pink-50 text-pink-600 border border-pink-200 hover:bg-pink-100'
                      : 'bg-white text-slate-500 hover:text-pink-500 hover:bg-pink-50/50 border border-slate-100'
                  }
                `}
              >
                <span className="font-medium">{DAYS[i]}</span>
                <span className={`
                  text-lg font-bold mt-1
                  ${isSelected ? 'text-white' : 'text-slate-700'}
                  ${isToday && !isSelected ? 'text-pink-600' : ''}
                `}>
                  {date.getUTCDate()}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Tabs y lista */}
      <div className="animate-fade-up animate-fade-up-delay-3">
        <div className="flex items-center justify-between mb-6">
          <div className="flex gap-1 bg-slate-100/80 border border-slate-200/60
                          rounded-xl p-1.5 shadow-inner">
            {[
              { key: 'upcoming', label: 'Próximas' },
              { key: 'history',  label: 'Historial' },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key as any)}
                className={`
                  px-5 py-2 rounded-lg text-sm font-semibold transition-all duration-300
                  ${tab === t.key
                    ? 'bg-white text-pink-600 shadow-sm border border-slate-100'
                    : 'text-slate-500 hover:text-pink-500 hover:bg-white/50'
                  }
                `}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'upcoming' && (
            <p className="text-sm font-medium text-slate-500 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-100">
              {new Date(selectedDate + 'T00:00:00Z').toLocaleDateString('es', {
                weekday: 'long', day: 'numeric', month: 'long',
                timeZone: 'UTC'
              })}
            </p>
          )}
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i}
                   className="bg-slate-50 border border-pink-50 rounded-2xl
                              h-28 animate-pulse shadow-sm" />
            ))}
          </div>
        ) : classes.length === 0 ? (
          <Card className="py-20 text-center bg-slate-50/50 border-dashed border-2 border-slate-200 rounded-3xl shadow-none">
            <div className="text-5xl mb-4 drop-shadow-sm">
              {tab === 'upcoming' ? '🌸' : '📋'}
            </div>
            <p className="text-slate-500 font-medium text-lg">
              {tab === 'upcoming'
                ? '¡Día libre! No tienes clases programadas.'
                : 'Aún no hay historial de clases.'
              }
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {classes.map(c => (
              <ClassCard key={c.id} class_={c} onUpdate={refetch} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}