"use client";

import { Clock, Languages, BookOpen } from "lucide-react";
import Image from "next/image";
import Carousel from "./Carousel";
import { LANGUAGES } from "@/lib/teacherOptions";
import type { LandingPackage } from "@/hooks/useLandingData";
import { priceLabelSuffix } from "@/lib/packageThemes";

function TeacherMiniAvatar({ name, url }: { name: string; url?: string | null }) {
  if (url) {
    return (
      <Image
        src={url}
        alt={name}
        width={24}
        height={24}
        className="w-6 h-6 rounded-full object-cover border border-white shadow-sm flex-shrink-0"
      />
    );
  }
  return (
    <span className="w-6 h-6 rounded-full bg-white/80 flex items-center justify-center text-[10px] font-black text-slate-500 flex-shrink-0">
      {name?.[0]?.toUpperCase() ?? "P"}
    </span>
  );
}

export default function PackagesCarousel({
  packages,
  showTeacher,
}: {
  packages: LandingPackage[];
  showTeacher: boolean;
}) {
  if (packages.length === 0) return null;

  return (
    <Carousel ariaLabel="Paquetes disponibles">
      {packages.map((pkg) => {
        const isLanguage = LANGUAGES.includes(pkg.subject);
        const accent = pkg.color || "#ec4899";
        return (
          <div
            key={pkg.id}
            className="snap-start flex-shrink-0 w-[270px] sm:w-[290px] rounded-[1.75rem] border border-slate-100 shadow-lg shadow-slate-200/40 p-6 flex flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl"
            style={{
              background: `linear-gradient(165deg, ${accent}20 0%, ${accent}08 40%, #ffffff 75%)`,
              borderTop: `4px solid ${accent}`,
            }}
          >
            <div className="flex items-center justify-between mb-4 gap-2">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shadow-sm flex-shrink-0"
                style={{ backgroundColor: `${accent}26` }}
              >
                {pkg.icon || "📦"}
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full bg-white/80 text-slate-600 border border-slate-100 truncate">
                {isLanguage ? <Languages className="w-3 h-3 flex-shrink-0" /> : <BookOpen className="w-3 h-3 flex-shrink-0" />}
                <span className="truncate">{pkg.subject}</span>
              </span>
            </div>

            <h3 className="text-base font-black text-slate-800 mb-1 leading-snug line-clamp-2">
              {pkg.name}
            </h3>
            <p className="text-xs text-slate-500 font-bold mb-4 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 flex-shrink-0" />
              {pkg.classes_count == null ? "Clases ilimitadas" : `${pkg.classes_count} clases`} · {pkg.duration_minutes} min c/u
            </p>

            <p className="text-2xl font-black mb-5" style={{ color: accent }}>
              ${pkg.price?.toFixed ? pkg.price.toFixed(2) : pkg.price}
              <span className="text-xs font-medium text-slate-500 ml-1">
                {priceLabelSuffix(pkg.classes_count)}
              </span>
            </p>

            {showTeacher && (
              <div className="mt-auto flex items-center gap-2 pt-4 border-t border-slate-100/80">
                <TeacherMiniAvatar name={pkg.teacher_name} url={pkg.teacher_avatar} />
                <span className="text-xs font-bold text-slate-600 truncate">{pkg.teacher_name}</span>
              </div>
            )}
          </div>
        );
      })}
    </Carousel>
  );
}