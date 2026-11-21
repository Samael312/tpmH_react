'use client'

import { useState } from 'react'
import { Download, FileText, Search } from 'lucide-react'
import { Card, Badge } from '@/components/ui'
import LoadMoreButton from '@/components/ui/LoadMoreButton'
import LoadError from '@/components/ui/LoadError'
import RefreshButton from '@/components/ui/RefreshButton'
import Skeleton from '@/components/ui/Skeleton'
import { useAdminMaterials } from '@/hooks/useAdminMaterials'
import { useLookupTeachers } from '@/hooks/useAdminClasses'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { usePageTopBar } from '@/lib/mobileTopBar'

function size(bytes: number | null) {
  if (!bytes) return ''
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export default function AdminMaterialsPage() {
  const [teacherId, setTeacherId] = useState<number | undefined>()
  const [text, setText] = useState('')
  const q = useDebouncedValue(text, 400)
  const { data: teachers = [] } = useLookupTeachers()
  const list = useAdminMaterials(teacherId, q)
  usePageTopBar({ title: 'Materiales', onRefresh: list.refetch, isFetching: list.isFetching })
  const teacherName = (id: number) => teachers.find(t => t.id === id)?.name ?? `Profesor #${id}`

  const input = 'w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-pink-300'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-800">Materiales</h1>
          <p className="text-sm text-slate-500">Materiales de cualquier profesor.</p>
        </div>
        <RefreshButton onRefresh={list.refetch} isFetching={list.isFetching} />
      </div>

      <Card className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <select className={input} value={teacherId ?? ''} onChange={e => setTeacherId(e.target.value ? Number(e.target.value) : undefined)} aria-label="Profesor">
          <option value="">Todos los profesores</option>
          {teachers.map(t => <option key={t.id} value={t.id}>{t.name} (@{t.username})</option>)}
        </select>
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className={`${input} pl-9`} placeholder="Buscar por título" value={text} onChange={e => setText(e.target.value)} />
        </div>
      </Card>

      {list.isError ? (
        <LoadError what="los materiales" onRetry={list.refetch} retrying={list.isFetching} />
      ) : list.loading ? (
        <Skeleton className="h-40 w-full" />
      ) : list.rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-400">No hay materiales.</Card>
      ) : (
        <Card className="overflow-hidden">
          <p className="px-4 py-2 text-xs font-bold text-slate-400">{list.total} materiales</p>
          <div className="divide-y divide-slate-100">
            {list.rows.map(m => (
              <div key={m.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-3">
                  <FileText className="w-5 h-5 text-pink-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{m.title}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {teacherName(m.teacher_id)} · {m.category}{m.level ? ` · ${m.level}` : ''} {size(m.file_size)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {m.file_type && <Badge variant="neutral">{m.file_type}</Badge>}
                  {m.file_url ? (
                    <a href={m.file_url} target="_blank" rel="noopener noreferrer" download
                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50">
                      <Download className="w-4 h-4" />Descargar
                    </a>
                  ) : <span className="text-xs text-slate-400">Sin archivo</span>}
                </div>
              </div>
            ))}
          </div>
          <LoadMoreButton hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
        </Card>
      )}
    </div>
  )
}
