"use client";

import { useState } from "react";
import { Play, X } from "lucide-react";
import Carousel from "./Carousel";

export interface VideoTeacher {
  user_username: string;
  name: string;
  title?: string | null;
  video_url: string;
  photo_url?: string | null;
}

export default function TeacherVideosCarousel({ teachers }: { teachers: VideoTeacher[] }) {
  const [active, setActive] = useState<VideoTeacher | null>(null);

  if (teachers.length === 0) return null;

  return (
    <>
      <Carousel ariaLabel="Videos de presentación de profesores">
        {teachers.map((t) => (
          <button
            key={t.user_username}
            onClick={() => setActive(t)}
            className="snap-start flex-shrink-0 w-[210px] sm:w-[230px] text-left group"
          >
            <div className="relative w-full aspect-[9/12] rounded-[1.75rem] overflow-hidden border border-slate-100 shadow-lg shadow-slate-200/50 bg-slate-900">
              {t.photo_url ? (
                <img
                  src={t.photo_url}
                  alt={t.name}
                  className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-500"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-pink-500 to-rose-400 flex items-center justify-center">
                  <span className="text-white text-4xl font-black">{t.name[0]?.toUpperCase()}</span>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/10 to-transparent" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-14 h-14 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                  <Play className="w-6 h-6 text-pink-600 fill-pink-600" />
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <p className="text-white font-black text-sm truncate drop-shadow">{t.name}</p>
                {t.title && <p className="text-white/80 text-[11px] font-semibold truncate">{t.title}</p>}
              </div>
            </div>
          </button>
        ))}
      </Carousel>

      {active && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm"
          onClick={() => setActive(null)}
        >
          <div className="relative w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setActive(null)}
              className="absolute -top-11 right-0 w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="rounded-[2rem] overflow-hidden bg-black shadow-2xl">
              <video
                src={active.video_url}
                controls
                autoPlay
                className="w-full max-h-[80vh] object-contain"
                poster={active.photo_url || undefined}
              />
            </div>
            <p className="text-white text-center font-bold mt-3">{active.name}</p>
          </div>
        </div>
      )}
    </>
  );
}