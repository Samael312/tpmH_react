"use client";

import { useState } from "react";
import Image from "next/image";
import { Play, X } from "lucide-react";
import Carousel from "./Carousel";
import { getVideoFirstFrameUrl } from "@/lib/videoThumbnail";

export interface VideoTeacher {
  user_username: string;
  name: string;
  title?: string | null;
  video_url: string;
}

function VideoCard({
  teacher,
  onOpen,
  size = "carousel",
}: {
  teacher: VideoTeacher;
  onOpen: () => void;
  size?: "carousel" | "featured";
}) {
  const thumb = getVideoFirstFrameUrl(teacher.video_url);
  const isFeatured = size === "featured";

  return (
    <button
      onClick={onOpen}
      className={`text-left group ${
        isFeatured
          ? "w-full max-w-sm mx-auto"
          : "snap-start flex-shrink-0 w-[210px] sm:w-[230px]"
      }`}
    >
      <div
        className={`relative w-full overflow-hidden rounded-[1.75rem] border border-slate-100 shadow-lg shadow-slate-200/50 bg-slate-900 ${
          isFeatured ? "aspect-[9/13]" : "aspect-[9/12]"
        }`}
      >
        {thumb ? (
          <Image
            src={thumb}
            alt={teacher.name}
            fill
            sizes={isFeatured ? "384px" : "230px"}
            className="object-cover opacity-90 group-hover:scale-105 transition-transform duration-500"
            onError={(e) => {
              // Fallback si Cloudinary no puede generar el frame (video aún procesándose, etc.)
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-pink-500 to-rose-400" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/10 to-transparent" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-14 h-14 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
            <Play className="w-6 h-6 text-pink-600 fill-pink-600" />
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <p className="text-white font-black text-sm truncate drop-shadow">{teacher.name}</p>
          {teacher.title && <p className="text-white/80 text-[11px] font-semibold truncate">{teacher.title}</p>}
        </div>
      </div>
    </button>
  );
}

export default function TeacherVideosCarousel({ teachers }: { teachers: VideoTeacher[] }) {
  const [active, setActive] = useState<VideoTeacher | null>(null);

  if (teachers.length === 0) return null;

  // Con un solo profesor (típico de single-tenant) no tiene sentido un
  // carrusel: mostramos la tarjeta directamente, más grande y centrada.
  const isSingle = teachers.length === 1;
  const activeThumb = active ? getVideoFirstFrameUrl(active.video_url) : null;

  return (
    <>
      {isSingle ? (
        <div className="relative w-full max-w-sm mx-auto">
          {/* Resplandor detrás del video */}
          <div className="absolute -inset-6 bg-gradient-to-br from-pink-500/30 via-rose-500/20 to-purple-500/30 rounded-[3rem] blur-2xl scale-95 animate-pulse pointer-events-none" />
          {/* Anillo punteado decorativo, girando lento */}
          <div className="absolute -inset-3 rounded-[2.25rem] border-2 border-dashed border-pink-400/30 animate-spin-slow pointer-events-none" />

          <VideoCard teacher={teachers[0]} onOpen={() => setActive(teachers[0])} size="featured" />

          {/* Insignia flotante */}
          <div className="absolute -bottom-4 -right-3 sm:-right-8 flex items-center gap-2 bg-white/95 backdrop-blur-sm rounded-2xl px-4 py-2.5 shadow-xl border border-slate-100 animate-float">
            <div className="w-6 h-6 rounded-full bg-pink-100 flex items-center justify-center flex-shrink-0">
              <Play className="w-3 h-3 text-pink-600 fill-pink-600" />
            </div>
            <span className="text-xs font-black text-slate-800 whitespace-nowrap">Video de presentación</span>
          </div>
        </div>
      ) : (
        <Carousel ariaLabel="Videos de presentación de profesores">
          {teachers.map((t) => (
            <VideoCard key={t.user_username} teacher={t} onOpen={() => setActive(t)} />
          ))}
        </Carousel>
      )}

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
                poster={activeThumb || undefined}
              />
            </div>
            <p className="text-white text-center font-bold mt-3">{active.name}</p>
          </div>
        </div>
      )}
    </>
  );
}
