"use client";

import Link from "next/link";
import { Star, Globe } from "lucide-react";

export interface TeacherSummary {
  user_username: string;
  name?: string;
  title: string | null;
  bio?: string | null;
  profile_photo_url?: string | null;
  languages: string[];
  subjects: string[];
  average_rating?: number;
  total_reviews?: number;
}

function displayName(t: TeacherSummary) {
  return t.name || t.user_username?.replace(/[_.]/g, " ") || "Profesor";
}

export default function TeacherCard({
  teacher,
  isMine = false,
}: {
  teacher: TeacherSummary;
  isMine?: boolean;
}) {
  const name = displayName(teacher);

  return (
    <Link
      href={`/dashboard/teachers/${teacher.user_username}`}
      className="group bg-white/85 backdrop-blur-xl rounded-[1.75rem] border border-white
                 shadow-lg shadow-slate-100 hover:shadow-xl hover:-translate-y-1
                 transition-all duration-300 p-6 flex flex-col relative overflow-hidden"
    >
      {isMine && (
        <span className="absolute top-4 right-4 text-[9px] font-black uppercase
                         tracking-widest px-2.5 py-1 rounded-full bg-emerald-100
                         text-emerald-700 shadow-sm">
          Tu profesor
        </span>
      )}

      <div className="w-16 h-16 rounded-2xl overflow-hidden border-2 border-white
                      shadow-md mb-4 bg-gradient-to-br from-pink-400 to-rose-400
                      flex items-center justify-center flex-shrink-0">
        {teacher.profile_photo_url ? (
          <img src={teacher.profile_photo_url} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-white font-black text-xl">{name[0]?.toUpperCase()}</span>
        )}
      </div>

      <h3 className="font-black text-slate-800 text-base truncate">{name}</h3>
      {teacher.title && (
        <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{teacher.title}</p>
      )}

      {typeof teacher.average_rating === "number" && (teacher.total_reviews ?? 0) > 0 && (
        <div className="flex items-center gap-1 mt-2">
          <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
          <span className="text-xs font-bold text-slate-700">{teacher.average_rating.toFixed(1)}</span>
          <span className="text-[10px] text-slate-400">({teacher.total_reviews} reseñas)</span>
        </div>
      )}

      {teacher.subjects?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {teacher.subjects.slice(0, 3).map(s => (
            <span key={s} className="px-2.5 py-1 bg-purple-50 text-purple-700 text-[10px]
                                     font-bold rounded-lg">
              {s}
            </span>
          ))}
        </div>
      )}

      {teacher.languages?.length > 0 && (
        <div className="flex items-center gap-1.5 mt-3 text-[10px] text-slate-400 font-bold">
          <Globe className="w-3 h-3" />
          {teacher.languages.slice(0, 3).join(" · ")}
        </div>
      )}

      <span className="mt-4 text-xs font-bold text-pink-600 group-hover:text-pink-700
                       transition-colors inline-flex items-center gap-1">
        Ver perfil completo →
      </span>
    </Link>
  );
}