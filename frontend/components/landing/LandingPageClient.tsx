"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import {
  Star, Check, Globe, Award,
  MessageCircle, ChevronDown, Menu, X,
  BookOpen, Clock, Users, Video as VideoIcon
} from "lucide-react";
import { useLandingData, displayName, type LandingData, type LandingTeacher } from "@/hooks/useLandingData";
import { useIsMobileOrReducedMotion } from "@/lib/useIsMobileOrReducedMotion";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import ChipiSection from "@/components/landing/ChipiSection";
import PackagesCarousel from "@/components/landing/PackagesCarousel";
import TeacherVideosCarousel from "@/components/landing/TeacherVideosCarousel";
import { priceLabelSuffix } from "@/lib/packageThemes";
import Skeleton from "@/components/ui/Skeleton";
import Reveal from "@/components/ui/Reveal";

// Three.js pesa bastante y es puramente decorativo: se carga solo en el
// cliente (nunca en SSR) y, más abajo, solo se monta si el viewport no
// es mobile y el usuario no pidió reduced-motion — así ese chunk ni se
// descarga en los casos donde menos aporta.
const HeroScene = dynamic(() => import("@/components/landing/HeroScene"), {
  ssr: false,
});

interface NavItem {
  id: string;
  label: string;
}

// ─── Navbar ─────────────────────────────────────────────────────────────────
function Navbar({ platformName, navItems }: { platformName: string; navItems: NavItem[] }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMobileOpen(false);
  };

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300
      ${scrolled ? "bg-white/90 backdrop-blur-xl shadow-lg shadow-slate-200/50 border-b border-rose-100" : "bg-transparent"}`}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-white shadow-md ring-1 ring-rose-300 bg-white flex items-center justify-center">
            <Image src="/assets/logo.png" alt="Logo" width={32} height={32} className="object-contain" />
          </div>
          <span className="font-black text-slate-800 text-lg tracking-tight">{platformName}</span>
        </div>

        <div className="hidden md:flex items-center gap-1">
          {navItems.map(item => (
            <button key={item.id} onClick={() => scrollTo(item.id)}
              className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-rose-600 rounded-full hover:bg-rose-50 transition-all duration-150">
              {item.label}
            </button>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Link href="/login" className="text-sm font-bold text-slate-700 bg-white border border-slate-100 shadow-sm hover:shadow-md px-5 py-2.5 rounded-full hover:-translate-y-0.5 transition-all duration-200">
            Iniciar sesión
          </Link>
          <Link href="/register" className="text-sm font-bold text-white px-5 py-2.5 rounded-full bg-rose-600 shadow-lg shadow-rose-200 hover:shadow-rose-300 hover:bg-rose-700 hover:-translate-y-0.5 active:scale-[0.97] transition-all duration-200">
            Empezar gratis
          </Link>
        </div>

        <button onClick={() => setMobileOpen(p => !p)} className="md:hidden w-9 h-9 rounded-full bg-white shadow-sm border border-slate-100 flex items-center justify-center text-slate-600">
          {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-white/95 backdrop-blur-xl border-t border-rose-100 px-4 py-4 space-y-1 animate-in slide-in-from-top-2 duration-200 shadow-xl">
          {navItems.map(item => (
            <button key={item.id} onClick={() => scrollTo(item.id)} className="w-full text-left px-4 py-3 text-sm font-bold text-slate-600 hover:bg-rose-50 hover:text-rose-600 rounded-2xl transition-colors">
              {item.label}
            </button>
          ))}
          <div className="pt-2 flex flex-col gap-2">
            <Link href="/login" className="w-full text-center py-3 text-sm font-bold text-slate-700 bg-white border border-slate-100 shadow-sm rounded-full">Iniciar sesión</Link>
            <Link href="/register" className="w-full text-center py-3 text-sm font-bold text-white bg-rose-600 rounded-full shadow-md shadow-rose-200">Empezar gratis</Link>
          </div>
        </div>
      )}
    </nav>
  );
}

// ─── Avatar con fallback a iniciales ──────────────────────────────────────────
function TeacherAvatar({ teacher, className, sizes = "200px", priority = false }: { teacher: LandingTeacher | undefined; className?: string; sizes?: string; priority?: boolean }) {
  const name = displayName(teacher);
  const photo = teacher?.profile_photo_url;
  if (photo) {
    // `priority` marca la imagen como LCP candidate para Next/Image: la
    // precarga (<link rel="preload">) y la sirve con loading="eager" +
    // fetchPriority="high" en vez de lazy-load por defecto. Se usa solo en
    // el hero (la foto que suele pintarse como Largest Contentful Paint),
    // nunca en el resto de avatares de la página.
    return <Image src={photo} alt={name} fill sizes={sizes} className={className} priority={priority} />;
  }
  return (
    <div className={`${className} bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center`}>
      <span className="text-3xl font-black text-white/90">{name[0]?.toUpperCase() ?? "T"}</span>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function LandingPageClient({ initialData }: { initialData?: LandingData | null }) {
  const { loading, isError, refetch, isSingleTenant, teachers, reviews, packages, platformName, platformTagline } = useLandingData(initialData);
  const isMobileOrReducedMotion = useIsMobileOrReducedMotion();
  // null = todavía no se sabe (primer paint) -> no montamos nada hasta confirmar
  // que corresponde, así el chunk de three.js ni se descarga en mobile.
  const shouldRenderHeroScene = isMobileOrReducedMotion === false;

  const mainTeacher = teachers[0];
  const avgRating = reviews.length > 0
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : 5;

  const openWhatsApp = () => {
    const phone = mainTeacher?.social_links?.whatsapp?.replace(/\D/g, "") ?? "";
    if (phone) window.open(`https://wa.me/${phone}`, "_blank");
  };

  const combinedSubjects = Array.from(new Set(teachers.flatMap(t => t.subjects ?? [])));
  const combinedLanguages = Array.from(new Set(teachers.flatMap(t => t.languages ?? [])));

  const videoTeachers = teachers
    .filter((t): t is typeof t & { video_url: string } => Boolean(t.video_url))
    .map(t => ({
      user_username: t.user_username,
      name: displayName(t),
      title: t.title,
      video_url: t.video_url as string,
    }));

  const individualPackages = packages.filter(p => !p.is_group);
  const groupPackages = packages.filter(p => p.is_group);

  const navItems: NavItem[] = [
    { id: "about", label: "Sobre nosotros" },
    ...(videoTeachers.length > 0 ? [{ id: "videos", label: "Videos" }] : []),
    { id: "chipi", label: "Chipi IA" },
    { id: "plans", label: "Planes" },
    ...(groupPackages.length > 0 ? [{ id: "group-plans", label: "Clases grupales" }] : []),
    { id: "reviews", label: "Reseñas" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-rose-50/30 to-white overflow-x-hidden selection:bg-rose-500 selection:text-white">
      <Navbar platformName={platformName} navItems={navItems} />

      {isError && (
        <div className="sticky top-16 z-40 bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-center text-sm font-semibold text-amber-800 flex items-center justify-center gap-3">
          No pudimos cargar el contenido de la página.
          <button
            onClick={() => refetch()}
            className="underline decoration-2 underline-offset-2 hover:text-amber-900"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* ─── Hero con Three.js ─── */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
        {shouldRenderHeroScene && <HeroScene />}

        {/* Blobs de refuerzo (Adaptados a la mainpage) */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-purple-200/60 mix-blend-multiply rounded-full blur-[120px] pointer-events-none animate-pulse" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-yellow-200/60 mix-blend-multiply rounded-full blur-[100px] pointer-events-none" style={{ animationDelay: '2s' }} />

        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center py-20">

          {/* Texto */}
          <div className="text-center lg:text-left animate-in fade-in slide-in-from-left-8 duration-700">
            <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm border border-rose-100 rounded-full px-4 py-2 shadow-sm mb-6">
              <div className="flex">
                {[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}
              </div>
              <span className="text-xs font-black text-slate-700">
                {avgRating.toFixed(1)} · {reviews.length}+ reseñas
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-extrabold text-slate-900 tracking-tight leading-[1.1] mb-6 drop-shadow-sm text-balance">
              {isSingleTenant ? (
                <>
                  Aprende idiomas{" "}
                  <span className="bg-gradient-to-r from-rose-500 to-pink-500 bg-clip-text text-transparent">
                    a tu ritmo
                  </span>
                </>
              ) : (
                <>
                  El conocimiento que buscas,{" "}
                  <span className="bg-gradient-to-r from-rose-500 to-pink-500 bg-clip-text text-transparent">
                    como tú lo prefieres
                  </span>
                </>
              )}
            </h1>

            <p className="text-xl text-slate-700 leading-relaxed mb-8 max-w-xl mx-auto lg:mx-0 font-semibold">
              {platformTagline ||
                (isSingleTenant
                  ? `Clases personalizadas 100% online con ${mainTeacher ? displayName(mainTeacher) : "una profesora certificada"}. Desde principiante hasta avanzado.`
                  : `Clases 100% online con nuestro equipo de ${teachers.length || "varios"} profesores certificados, para cada objetivo y nivel.`)}
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <Link href="/register" className="px-8 py-3.5 bg-slate-900 text-white font-bold text-sm rounded-full shadow-xl hover:shadow-2xl hover:-translate-y-1 active:scale-[0.97] transition-all duration-300 text-center">
                Empezar ahora
              </Link>
              {isSingleTenant && mainTeacher?.social_links?.whatsapp && (
                <button onClick={openWhatsApp} className="px-8 py-3.5 bg-white border-2 border-slate-100 text-slate-700 font-bold text-sm rounded-full hover:border-rose-200 hover:text-rose-600 hover:bg-white/50 transition-all duration-300 flex items-center justify-center gap-2 shadow-sm">
                  <MessageCircle className="w-4 h-4" /> Contactar por WhatsApp
                </button>
              )}
            </div>

            <div className="flex items-center gap-6 mt-8 justify-center lg:justify-start">
              {[
                { icon: <Users className="w-4 h-4" />, label: isSingleTenant ? "Estudiantes satisfechos" : "Profesores activos", value: isSingleTenant ? "100+" : `${teachers.length}` },
                { icon: <Globe className="w-4 h-4" />, label: "Idiomas", value: `${combinedLanguages.length || 1}+` },
                { icon: <Clock className="w-4 h-4" />, label: "Horas de clase", value: "800+" },
              ].map(stat => (
                <div key={stat.label} className="text-center">
                  <p className="text-2xl font-black text-slate-900">{stat.value}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Visual: foto única o collage de hasta 5 */}
          <div className="flex justify-center lg:justify-end animate-in fade-in slide-in-from-right-8 duration-700 delay-150">
            {isSingleTenant ? (
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-rose-300 to-pink-300 rounded-[3rem] blur-2xl opacity-40 scale-105" />
                <div className="relative w-72 h-80 sm:w-80 sm:h-96 rounded-[3rem] overflow-hidden border-4 border-white shadow-2xl ring-1 ring-rose-200 bg-slate-200 rotate-3 hover:rotate-1 transition-transform duration-700">
                  <TeacherAvatar teacher={mainTeacher} className="object-cover" sizes="(max-width: 640px) 288px, 320px" priority />
                </div>

                <div className="absolute -bottom-4 -left-4 bg-white/95 backdrop-blur-sm rounded-2xl px-4 py-3 shadow-xl border border-slate-100 animate-[float_5s_ease-in-out_infinite]">
                  <div className="flex items-center gap-2">
                    <div className="flex">{[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}</div>
                    <span className="text-sm font-black text-slate-800">{avgRating.toFixed(1)}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5">{reviews.length} reseñas verificadas</p>
                </div>

                <div className="absolute -top-4 -right-4 bg-white/95 backdrop-blur-sm rounded-2xl px-4 py-3 shadow-xl border border-slate-100 flex items-center gap-2 animate-[float_5s_ease-in-out_infinite]" style={{ animationDelay: '1s' }}>
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center"><Check className="w-4 h-4 text-green-600" /></div>
                  <div>
                    <p className="text-xs font-black text-slate-800">Certificada</p>
                    <p className="text-[10px] text-slate-400 font-bold">Bilingüe</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="relative w-full max-w-md animate-in fade-in duration-500">
                <div className="absolute inset-0 bg-gradient-to-br from-rose-300 to-pink-300 rounded-[3rem] blur-2xl opacity-30 scale-105" />
                <div className="relative grid grid-cols-2 gap-4">
                  {teachers.slice(0, 4).map((t, i) => {
                    const remaining = teachers.length - 3;
                    const isMoreTile = i === 3 && remaining > 1;
                    return (
                      <Link
                        key={t.user_username}
                        href={isMoreTile ? "/dashboard/teachers" : `/dashboard/teachers/${t.user_username}`}
                        className={`group relative overflow-hidden rounded-[1.75rem] border-4 border-white shadow-2xl ring-1 ring-rose-200 ${i === 0 ? "col-span-2 aspect-[16/10]" : "aspect-square"}`}
                      >
                        <TeacherAvatar
                          teacher={t}
                          className="object-cover group-hover:scale-110 transition-transform duration-700"
                          sizes="(max-width: 640px) 50vw, 220px"
                          priority={i === 0}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/10 to-transparent" />
                        {isMoreTile ? (
                          <div className="absolute inset-0 bg-slate-900/70 flex flex-col items-center justify-center group-hover:bg-slate-900/80 transition-colors">
                            <span className="text-white font-black text-2xl">+{remaining}</span>
                            <span className="text-white/80 text-[10px] font-bold uppercase tracking-widest">ver todos</span>
                          </div>
                        ) : (
                          <div className="absolute bottom-0 left-0 right-0 p-4">
                            <p className="text-white font-black text-sm truncate drop-shadow-md">{displayName(t)}</p>
                            {t.title && <p className="text-white/80 text-[10px] font-semibold truncate">{t.title}</p>}
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
                <Link
                  href="/dashboard/teachers"
                  className="mt-4 flex items-center justify-center gap-1.5 text-sm font-bold text-rose-600 hover:text-rose-700 transition-colors"
                >
                  Ver todos los profesores
                  <ChevronDown className="w-4 h-4 -rotate-90" />
                </Link>
              </div>
            )}
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-slate-400 animate-bounce z-10 cursor-pointer" onClick={() => document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' })}>
          <span className="text-[10px] font-bold uppercase tracking-widest text-rose-500">Ver más</span>
          <ChevronDown className="w-4 h-4 text-rose-500" />
        </div>
      </section>

      {/* ─── Videos de presentación (Estilo Dark Glassmorphism) ─── */}
      {(loading || videoTeachers.length > 0) && (
        <section id="videos" className="py-24 relative overflow-hidden bg-slate-900">
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900 via-slate-900 to-[#0B1120]" />
          {/* Textura de puntos sutil para no dejar el fondo plano */}
          <div
            className="absolute inset-0 opacity-[0.06] pointer-events-none"
            style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "26px 26px" }}
          />
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-rose-900/20 rounded-full blur-[90px] pointer-events-none animate-blob" />
          <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-cyan-900/20 rounded-full blur-[90px] pointer-events-none animate-blob" style={{ animationDelay: '3s' }} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[420px] bg-purple-800/10 rounded-full blur-[110px] pointer-events-none" />
          
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 z-10">
            <Reveal className="text-center mb-12">
              <p className="text-[10px] font-bold text-rose-400 uppercase tracking-widest mb-3 flex items-center justify-center gap-1.5">
                <VideoIcon className="w-3.5 h-3.5" /> Presentaciones
              </p>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white tracking-tight mb-4">
                {isSingleTenant ? "Escucha a tu profesora" : "Escucha a nuestros profesores"}
              </h2>
              <div className="w-20 h-1 bg-gradient-to-r from-rose-500 to-transparent rounded-full mx-auto my-4" />
              <p className="text-slate-400 max-w-lg mx-auto text-lg font-light">
                Antes de reservar tu clase, mira quién estará al otro lado de la pantalla.
              </p>
            </Reveal>

            {loading ? (
              <div className="flex gap-5 overflow-hidden">
                {[1,2,3].map(i => (
                  <Skeleton key={i} className="w-[210px] aspect-[9/12] rounded-[1.75rem] flex-shrink-0 bg-slate-800/40 border border-white/5" />
                ))}
              </div>
            ) : (
              <Reveal>
                <TeacherVideosCarousel teachers={videoTeachers} />
              </Reveal>
            )}
          </div>
        </section>
      )}

      {/* ─── Sobre nosotros / equipo ─── */}
      <section id="about" className="py-24 relative overflow-hidden bg-white">
        <div className="absolute top-0 left-0 w-[400px] h-[400px] bg-rose-300/50 mix-blend-multiply rounded-full blur-[100px] pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 z-10">
          <Reveal className="text-center mb-16">
            <p className="text-[10px] font-bold text-rose-600 uppercase tracking-widest mb-3">
              {isSingleTenant ? "Sobre mí" : "Nuestro equipo"}
            </p>
            <h2 className="text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight mb-4">
              {isSingleTenant ? "Conoceme un poco mejor" : "Conoce a nuestros profesores"}
            </h2>
            <p className="text-slate-500 max-w-xl mx-auto leading-relaxed text-lg">
              {isSingleTenant
                ? "Una apasionada del idioma con años de experiencia enseñando a estudiantes de todos los niveles y países."
                : "Un equipo de profesores certificados, cada uno con su propia especialidad, listos para acompañarte."}
            </p>
          </Reveal>

          {loading ? (
            <Skeleton className="h-64 w-full rounded-[2rem]" />
          ) : isSingleTenant ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
              <Reveal className="bg-white/80 backdrop-blur-sm rounded-[2rem] border border-rose-100 shadow-xl p-8">
                <p className="text-slate-600 leading-relaxed text-lg mb-6">
                  {mainTeacher?.bio ?? "Profesora certificada y bilingüe con pasión por enseñar de forma personalizada. Mi metodología se adapta a tus objetivos y ritmo de aprendizaje."}
                </p>
                {mainTeacher?.skills?.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-6">
                    {mainTeacher.skills.map((s: string) => (
                      <span key={s} className="px-3 py-1.5 bg-rose-50 border border-rose-100 text-rose-700 text-xs font-bold rounded-full">{s}</span>
                    ))}
                  </div>
                )}
                {mainTeacher?.certificates?.length > 0 && (
                  <div className="space-y-2">
                    {mainTeacher.certificates.map((c, i) => (
                      <div key={i} className="flex items-center gap-3 bg-green-50 rounded-xl px-4 py-3 border border-green-100">
                        <Award className="w-4 h-4 text-green-600 flex-shrink-0" />
                        <span className="text-sm font-bold text-slate-800">{c.title}</span>
                        <span className="ml-auto text-xs font-black text-slate-400">{c.year}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Reveal>

              <div className="grid grid-cols-2 gap-4">
                {[
                  { value: "100%", label: "Online", sub: "Desde cualquier lugar", icon: <Globe className="w-6 h-6 text-rose-500" />, bg: "bg-rose-50 border-rose-100" },
                  { value: avgRating.toFixed(1), label: "Rating", sub: `${reviews.length} reseñas`, icon: <Star className="w-6 h-6 text-amber-500 fill-amber-500" />, bg: "bg-amber-50 border-amber-100" },
                  { value: `${combinedLanguages.length || 2}+`, label: "Idiomas", sub: combinedLanguages.slice(0,2).join(" · ") || "Inglés · Español", icon: <BookOpen className="w-6 h-6 text-purple-500" />, bg: "bg-purple-50 border-purple-100" },
                  { value: "50+", label: "Estudiantes", sub: "De 10+ países", icon: <Users className="w-6 h-6 text-emerald-500" />, bg: "bg-emerald-50 border-emerald-100" },
                ].map((stat, idx) => (
                  <Reveal key={stat.label} delay={idx * 90} className={`${stat.bg} border rounded-[1.5rem] p-6 flex flex-col items-center text-center shadow-sm`}>
                    <div className="mb-3">{stat.icon}</div>
                    <p className="text-3xl font-extrabold text-slate-900 leading-none">{stat.value}</p>
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-wider mt-2">{stat.label}</p>
                    <p className="text-xs text-slate-500 mt-1">{stat.sub}</p>
                  </Reveal>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {teachers.map((t, idx) => (
                <Reveal key={t.user_username} delay={(idx % 3) * 100} className="bg-white/80 backdrop-blur-sm rounded-[2rem] border border-rose-100 shadow-xl p-6 flex flex-col items-center text-center hover:-translate-y-1 hover:shadow-2xl transition-all duration-300">
                  <div className="relative w-20 h-20 rounded-full overflow-hidden border-2 border-white shadow-lg ring-1 ring-rose-200 mb-4">
                    <TeacherAvatar teacher={t} className="object-cover" sizes="80px" />
                  </div>
                  <h3 className="font-extrabold text-slate-900 text-lg">{displayName(t)}</h3>
                  {t.title && <p className="text-xs text-slate-500 mt-1">{t.title}</p>}
                  {t.subjects?.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-1.5 mt-4">
                      {t.subjects.slice(0, 3).map(s => (
                        <span key={s} className="px-2.5 py-1 bg-rose-50 border border-rose-100 text-rose-600 text-[10px] font-bold rounded-full">{s}</span>
                      ))}
                    </div>
                  )}
                  <Link href={`/teachers/${t.user_username}`} className="mt-5 text-xs font-bold text-rose-600 hover:text-rose-700 transition-colors bg-rose-50 px-4 py-2 rounded-full">
                    Ver perfil →
                  </Link>
                </Reveal>
              ))}
              {teachers.length === 0 && (
                <p className="col-span-full text-center text-slate-400 font-bold py-10">
                  Aún no hay profesores aprobados para mostrar
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ─── Materias combinadas (solo multi-tenant) ─── */}
      {!isSingleTenant && combinedSubjects.length > 0 && (
        <section className="pb-12 bg-white">
          <Reveal className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-wrap justify-center gap-3">
            {combinedSubjects.map(s => (
              <span key={s} className="px-4 py-2 bg-slate-50 border border-slate-100 shadow-sm text-slate-600 text-sm font-bold rounded-full">
                {s}
              </span>
            ))}
          </Reveal>
        </section>
      )}

      

      {/* ─── Chipi, el asistente IA ─── */}
      <Reveal>
        <ChipiSection />
      </Reveal>

      {/* ─── Planes / Paquetes reales de los profesores ─── */}
      <section id="plans" className="py-24 relative overflow-hidden bg-white">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-purple-200/40 mix-blend-multiply rounded-full blur-[120px] pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 z-10">
          <Reveal className="text-center mb-20">
            <p className="text-[10px] font-bold text-rose-600 uppercase tracking-widest mb-3">Planes y precios</p>
            <h2 className="text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight mb-4">Elige tu plan</h2>
            <p className="text-slate-500 max-w-xl mx-auto text-lg">Sin contratos. Sin letra pequeña. Solo aprendizaje.</p>
          </Reveal>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
              {[1, 2, 3, 4].map(i => (
                <Skeleton key={i} className="h-96 w-full rounded-[2rem]" />
              ))}
            </div>
          ) : individualPackages.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-400 font-bold">Aún no hay paquetes disponibles</p>
            </div>
          ) : (
            // flex-wrap + justify-center en vez de CSS grid: así, sin
            // importar cuántos paquetes haya (1, 2, 3...), quedan repartidos
            // simétricamente y centrados en vez de pegados a la izquierda
            // con una fila incompleta. El ancho de cada tarjeta replica el
            // que tendría en un grid de 2/4 columnas (mismo gap-8 = 2rem).
            <div className="flex flex-wrap justify-center gap-8">
              {individualPackages.slice(0, 8).map((pkg, idx) => {
                const accent = pkg.color || "#e11d48"; // Default a rose-600
                const priceSuffix = priceLabelSuffix(pkg.classes_count);
                const priceDisplay = Number.isInteger(pkg.price) ? pkg.price : pkg.price.toFixed(2);

                const bullets: string[] =
                  pkg.description_type === "list" && pkg.description_items?.length
                    ? pkg.description_items
                    : [
                        pkg.classes_count == null ? "Clases ilimitadas" : `${pkg.classes_count} clases`,
                        `${pkg.duration_minutes} min por clase`,
                        "Modalidad 100% online",
                        ...(pkg.description ? [pkg.description] : []),
                      ];

                return (
                  <Reveal
                    key={pkg.id}
                    delay={(idx % 4) * 90}
                    className="relative w-full sm:w-[calc(50%-1rem)] lg:w-[calc(25%-1.5rem)] bg-white/80 backdrop-blur-sm rounded-[2rem] border border-rose-100 shadow-xl flex flex-col p-8 transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl bg-white"
                  >
                    <div className="mb-6">
                      <h3 className="text-xl font-bold mb-2" style={{ color: accent }}>
                        {pkg.name}
                      </h3>
                      <div className="flex items-baseline gap-1">
                        <span className="text-4xl font-extrabold text-slate-900">${priceDisplay}</span>
                        <span className="text-slate-500 text-sm font-medium">{priceSuffix}</span>
                      </div>
                    </div>
                    
                    <div className="h-px w-full bg-slate-100 mb-6" />

                    <div className="flex-1 space-y-4 mb-8">
                      {bullets.slice(0, 6).map((f, i) => (
                        <div key={i} className="flex items-start gap-3">
                          <Check className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accent }} />
                          <span className="text-sm text-slate-600 leading-snug">{f}</span>
                        </div>
                      ))}
                    </div>

                    <Link
                      href="/register"
                      className="w-full py-3.5 text-sm font-bold text-center rounded-full transition-transform duration-200 block active:scale-95 text-white shadow-lg hover:shadow-xl"
                      style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}
                    >
                      Elegir {pkg.name}
                    </Link>
                  </Reveal>
                );
              })}
            </div>
          )}

          {isSingleTenant && mainTeacher?.social_links?.whatsapp && (
            <p className="text-center text-xs text-slate-400 font-bold mt-12">
              ¿Tienes dudas?{" "}
              <button onClick={openWhatsApp} className="text-rose-500 hover:text-rose-600 underline transition-colors">
                Escríbeme por WhatsApp
              </button>
            </p>
          )}
        </div>
      </section>

      {/* ─── Clases grupales ─── */}
      {groupPackages.length > 0 && (
        <section id="group-plans" className="py-24 relative overflow-hidden bg-slate-50 border-y border-slate-100">
          <div className="absolute top-0 left-0 w-[450px] h-[450px] bg-purple-200/40 mix-blend-multiply rounded-full blur-[110px] pointer-events-none" />
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 z-10">
            <Reveal className="text-center mb-14">
              <p className="text-[10px] font-bold text-rose-600 uppercase tracking-widest mb-3 flex items-center justify-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Clases grupales
              </p>
              <h2 className="text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight mb-4">
                Aprende en grupo, paga menos
              </h2>
              <p className="text-slate-500 max-w-xl mx-auto text-lg">
                {isSingleTenant
                  ? "Comparte la clase con otros estudiantes de tu nivel y ahorra frente al plan individual."
                  : "Varios de nuestros profesores arman grupos reducidos por nivel e idioma. Comparten la clase, comparten el precio."}
              </p>
            </Reveal>

            {/* Cómo funciona */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-16">
              {[
                {
                  step: "1",
                  title: "Te inscribes",
                  desc: "Eliges un paquete grupal y reservas tu cupo. Cada grupo tiene un mínimo y un máximo de alumnos.",
                },
                {
                  step: "2",
                  title: "Se completa el grupo",
                  desc: "Cuando se alcanza el mínimo de estudiantes, el horario del grupo queda confirmado para todos.",
                },
                {
                  step: "3",
                  title: "Empiezan las clases",
                  desc: "Si el grupo no se llega a completar, siempre puedes pasar tu cupo a clases individuales.",
                },
              ].map((s, idx) => (
                <Reveal key={s.step} delay={idx * 120} className="bg-white rounded-[1.75rem] border border-slate-100 shadow-sm p-6 flex flex-col items-center text-center">
                  <div className="w-10 h-10 rounded-full bg-rose-600 text-white font-black flex items-center justify-center mb-4">
                    {s.step}
                  </div>
                  <h3 className="font-extrabold text-slate-900 mb-2">{s.title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{s.desc}</p>
                </Reveal>
              ))}
            </div>

            <Reveal>
              <PackagesCarousel packages={groupPackages} showTeacher={!isSingleTenant} />
            </Reveal>
          </div>
        </section>
      )}

      {/* ─── Reseñas ─── */}
      <section id="reviews" className="py-24 relative overflow-hidden border-y border-slate-100 bg-slate-50">
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-rose-300/40 mix-blend-multiply rounded-full blur-[100px] pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 z-10">
          <Reveal className="text-center mb-16">
            <p className="text-[10px] font-bold text-rose-600 uppercase tracking-widest mb-3">Testimonios</p>
            <h2 className="text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight mb-4">
              {isSingleTenant ? "Lo que dicen mis alumnos" : "Historias de Éxito"}
            </h2>
            <div className="flex items-center justify-center gap-2">
              <div className="flex">{[1,2,3,4,5].map(i => <Star key={i} className="w-5 h-5 text-amber-400 fill-amber-400" />)}</div>
              <span className="text-slate-900 font-extrabold">{avgRating.toFixed(1)}</span>
              <span className="text-slate-500 text-lg">Personas reales, resultados reales.</span>
            </div>
          </Reveal>

          {reviews.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-400 font-bold">Sé el primero en dejar una reseña tras tu clase</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {reviews.slice(0, 6).map((r, idx) => (
                <Reveal key={r.id} delay={(idx % 3) * 120} className="bg-white/90 backdrop-blur-sm rounded-2xl border border-rose-50 shadow-lg shadow-slate-200/50 p-6 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center flex-shrink-0 shadow-sm border border-rose-100">
                      <span className="text-rose-600 font-bold text-sm">{r.student_name?.[0] ?? "?"}</span>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">{r.student_name}</p>
                      <div className="flex">
                        {[1,2,3,4,5].map(i => (
                          <Star key={i} className={`w-3 h-3 ${i <= r.rating ? "text-amber-400 fill-amber-400" : "text-slate-300"}`} />
                        ))}
                      </div>
                    </div>
                    {!isSingleTenant && r.teacher_username && (
                      <span className="ml-auto text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-full">
                        @{r.teacher_username}
                      </span>
                    )}
                  </div>
                  <div className="text-rose-200 mb-[-10px]"><svg className="w-6 h-6 fill-current" viewBox="0 0 24 24"><path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/></svg></div>
                  <p className="text-sm text-slate-600 leading-relaxed italic relative z-10">&quot;{r.comment}&quot;</p>
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ─── CTA Final ─── */}
      <section className="py-24 relative overflow-hidden bg-white">
        {/* Fondo decorativo sutil en vez de bloque sólido */}
        <div className="absolute inset-0 bg-gradient-to-tr from-slate-50 to-rose-50/40 pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] bg-rose-200/40 rounded-full mix-blend-multiply blur-3xl pointer-events-none" />

        <Reveal className="relative max-w-2xl mx-auto px-4 sm:px-6 text-center z-10">
          <h2 className="text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight mb-4">¿Listo para empezar?</h2>
          <p className="text-slate-500 text-lg mb-8 leading-relaxed font-medium">
            Tu primera clase de prueba es gratuita. Sin compromisos, sin tarjeta de crédito.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register" className="px-8 py-4 bg-slate-900 text-white font-bold text-sm rounded-full shadow-xl shadow-slate-900/10 hover:shadow-2xl hover:scale-105 transition-all duration-300">
              Crear cuenta gratis
            </Link>
            {isSingleTenant && mainTeacher?.social_links?.whatsapp && (
              <button onClick={openWhatsApp} className="px-8 py-4 bg-white text-slate-700 font-bold text-sm rounded-full border border-slate-200 hover:bg-slate-50 hover:border-rose-300 transition-all duration-300 flex items-center justify-center gap-2 shadow-sm">
                <MessageCircle className="w-4 h-4 text-rose-500" /> Hablar por WhatsApp
              </button>
            )}
          </div>
        </Reveal>
      </section>

      {/* ─── Footer (Estilo oscuro) ─── */}
      <footer className="bg-slate-900 text-white pt-16 pb-8 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-12">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-white/20 bg-white flex items-center justify-center">
                <Image src="/assets/logo.png" alt="Logo" width={32} height={32} className="object-contain" />
              </div>
              <span className="font-bold text-xl tracking-tight">{platformName}</span>
            </div>
            <div className="flex gap-6 text-sm text-slate-400 font-semibold">
              <Link href="/login" className="hover:text-rose-400 transition-colors">Iniciar sesión</Link>
              <Link href="/register" className="hover:text-rose-400 transition-colors">Registrarse</Link>
            </div>
          </div>
          <div className="border-t border-slate-800/50 pt-8 text-center md:text-left flex flex-col md:flex-row justify-between items-center">
            <p className="text-slate-500 text-sm">© {new Date().getFullYear()} {platformName} · Todos los derechos reservados</p>
            <p className="text-slate-600 text-xs mt-4 md:mt-0 uppercase tracking-widest font-bold">Empoderando estudiantes</p>
          </div>
        </div>
      </footer>

      <ChipiWidget screenName="main" />
    </div>
  );
}