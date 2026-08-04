"use client";

import Link from "next/link";
import { Star, Globe, ArrowRight } from "lucide-react";

export interface TeacherSummary {
  user_username: string;
  name?: string;
  surname?: string;
  title: string | null;
  bio?: string | null;
  profile_photo_url?: string | null;
  languages: string[];
  subjects: string[];
  average_rating?: number;
  total_reviews?: number;
}

function displayName(t: TeacherSummary) {
  const full = [t.name, t.surname].filter(Boolean).join(" ").trim();
  return full || t.user_username?.replace(/[_.]/g, " ") || "Profesor";
}

export default function TeacherCard({
  teacher,
  isMine = false,
}: {
  teacher: TeacherSummary;
  isMine?: boolean;
}) {
  const name = displayName(teacher);
  const initial = name[0]?.toUpperCase() ?? "T";

  return (
    <Link
      href={`/dashboard/teachers/${teacher.user_username}`}
      className="group relative bg-white rounded-[2rem] border border-slate-100
                 shadow-lg shadow-slate-200/50 hover:shadow-2xl hover:shadow-pink-200/40
                 hover:-translate-y-1.5 transition-all duration-300 overflow-hidden flex flex-col"
    >
      {isMine && (
        <span className="absolute top-4 right-4 z-20 text-[9px] font-black uppercase
                         tracking-widest px-3 py-1.5 rounded-full bg-emerald-500 text-white
                         shadow-lg shadow-emerald-500/30">
          Tu profesor
        </span>
      )}

      {/* Foto hero */}
      <div className="relative w-full aspect-[4/5] overflow-hidden bg-gradient-to-br from-pink-400 via-rose-400 to-purple-400">
        {teacher.profile_photo_url ? (
          <img
            src={teacher.profile_photo_url}
            alt={name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-white/90 text-8xl font-black drop-shadow-lg select-none">
              {initial}
            </span>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/85 via-slate-900/10 to-transparent" />

        {typeof teacher.average_rating === "number" && (teacher.total_reviews ?? 0) > 0 && (
          <div className="absolute top-4 left-4 flex items-center gap-1 bg-white/95 backdrop-blur-md
                          px-2.5 py-1 rounded-full shadow-md">
            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
            <span className="text-xs font-black text-slate-800">{teacher.average_rating.toFixed(1)}</span>
            <span className="text-[10px] text-slate-500 font-bold">({teacher.total_reviews})</span>
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 p-5">
          <h3 className="font-black text-white text-xl leading-tight drop-shadow-md truncate">
            {name}
          </h3>
          {teacher.title && (
            <p className="text-white/85 text-xs font-semibold mt-0.5 line-clamp-1 drop-shadow-sm">
              {teacher.title}
            </p>
          )}
        </div>
      </div>

      {/* Cuerpo */}
      <div className="p-5 flex flex-col flex-1">
        {teacher.subjects?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {teacher.subjects.slice(0, 3).map(s => (
              <span key={s} className="px-2.5 py-1 bg-purple-50 text-purple-700 text-[10px] font-bold rounded-lg">
                {s}
              </span>
            ))}
          </div>
        )}

        {teacher.languages?.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-bold mb-4">
            <Globe className="w-3.5 h-3.5" />
            {teacher.languages.slice(0, 3).join(" · ")}
          </div>
        )}

        <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-bold text-pink-600
                         group-hover:text-pink-700 group-hover:gap-2.5 transition-all">
          Ver perfil completo <ArrowRight className="w-4 h-4" />
        </span>
      </div>
    </Link>
  );
}