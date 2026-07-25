"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Star, Check, Globe, Award,
  MessageCircle, ChevronDown, Menu, X,
  BookOpen, Clock, Users
} from "lucide-react";
import { useLandingData, displayName } from "@/hooks/useLandingData";
import HeroScene from "@/components/landing/HeroScene";
import ChipiWidget from "@/components/chipi/ChipiWidget";

const PACKAGES = [
  {
    name: "Básico", price: "$57", period: "/mes", classes: 4,
    border: "border-slate-200", accent: "text-slate-700",
    features: ["4 clases al mes", "Modalidad 100% online", "Material incluido", "Clases conversacionales", "Ritmo sin presión"],
  },
  {
    name: "Personalizado", price: "$96", period: "/mes", classes: 8, popular: true,
    border: "border-pink-300", accent: "text-pink-600",
    features: ["8 clases al mes", "Modalidad 100% online", "Material incluido", "100% personalizadas", "Progreso y flexibilidad"],
  },
  {
    name: "Intensivo", price: "$138", period: "/mes", classes: 12,
    border: "border-purple-200", accent: "text-purple-700",
    features: ["12 clases al mes", "Modalidad 100% online", "Material incluido", "Preparación exámenes", "Avance acelerado"],
  },
  {
    name: "Flexible", price: "$12", period: "/clase", classes: 1,
    border: "border-emerald-200", accent: "text-emerald-700",
    features: ["Paga por clase", "Modalidad 100% online", "Sin compromiso mensual", "Horario flexible", "Ideal para empezar"],
  },
];

// ─── Navbar ─────────────────────────────────────────────────────────────────
function Navbar({ platformName }: { platformName: string }) {
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
      ${scrolled ? "bg-white/90 backdrop-blur-xl shadow-lg shadow-slate-200/50 border-b border-white" : "bg-transparent"}`}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg overflow-hidden">
            <Image src="/assets/logo.png" alt="Logo" width={32} height={32} className="object-contain" />
          </div>
          <span className="font-black text-slate-800 text-lg tracking-tight">{platformName}</span>
        </div>

        <div className="hidden md:flex items-center gap-1">
          {[{ id: "about", label: "Sobre nosotros" }, { id: "plans", label: "Planes" }, { id: "reviews", label: "Reseñas" }].map(item => (
            <button key={item.id} onClick={() => scrollTo(item.id)}
              className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-pink-600 rounded-xl hover:bg-pink-50 transition-all duration-150">
              {item.label}
            </button>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Link href="/login" className="text-sm font-bold text-slate-600 hover:text-pink-600 px-4 py-2 rounded-xl hover:bg-pink-50 transition-all duration-150">
            Iniciar sesión
          </Link>
          <Link href="/register" className="text-sm font-bold text-white px-5 py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-md shadow-pink-200 hover:shadow-pink-300 active:scale-[0.97] transition-all duration-200">
            Empezar gratis
          </Link>
        </div>

        <button onClick={() => setMobileOpen(p => !p)} className="md:hidden w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
          {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-white/95 backdrop-blur-xl border-t border-slate-100 px-4 py-4 space-y-1 animate-in slide-in-from-top-2 duration-200">
          {[{ id: "about", label: "Sobre nosotros" }, { id: "plans", label: "Planes" }, { id: "reviews", label: "Reseñas" }].map(item => (
            <button key={item.id} onClick={() => scrollTo(item.id)} className="w-full text-left px-4 py-3 text-sm font-bold text-slate-600 hover:bg-pink-50 hover:text-pink-600 rounded-xl transition-colors">
              {item.label}
            </button>
          ))}
          <div className="pt-2 flex flex-col gap-2">
            <Link href="/login" className="w-full text-center py-3 text-sm font-bold text-slate-600 bg-slate-100 rounded-xl">Iniciar sesión</Link>
            <Link href="/register" className="w-full text-center py-3 text-sm font-bold text-white bg-gradient-to-r from-pink-500 to-rose-400 rounded-xl shadow-md shadow-pink-200">Empezar gratis</Link>
          </div>
        </div>
      )}
    </nav>
  );
}

// ─── Avatar con fallback a iniciales ──────────────────────────────────────────
function TeacherAvatar({ teacher, className }: { teacher: any; className?: string }) {
  const name = displayName(teacher);
  if (teacher?.photo_url) {
    return <img src={teacher.photo_url} alt={name} className={className} />;
  }
  return (
    <div className={`${className} bg-gradient-to-br from-pink-200 to-rose-300 flex items-center justify-center`}>
      <span className="text-3xl font-black text-white/70">{name[0]?.toUpperCase() ?? "T"}</span>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function LandingPage() {
  const { loading, isSingleTenant, teachers, reviews, platformName, platformTagline } = useLandingData();

  const mainTeacher = teachers[0];
  const avgRating = reviews.length > 0
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : 5;

  const openWhatsApp = () => {
    const phone = mainTeacher?.social_links?.whatsapp?.replace(/\D/g, "") ?? "";
    if (phone) window.open(`https://wa.me/${phone}`, "_blank");
  };

  // Combinar subjects/languages/skills de todos los profesores (multi-tenant)
  const combinedSubjects = Array.from(new Set(teachers.flatMap(t => t.subjects ?? [])));
  const combinedLanguages = Array.from(new Set(teachers.flatMap(t => t.languages ?? [])));

  return (
    <div className="min-h-screen bg-slate-50 overflow-x-hidden">
      <Navbar platformName={platformName} />

      {/* ─── Hero con Three.js ─── */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
        <HeroScene />

        {/* Blobs de refuerzo detrás del canvas */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-pink-300/15 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-rose-300/15 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center py-20">

          {/* Texto */}
          <div className="text-center lg:text-left animate-in fade-in slide-in-from-left-8 duration-700">
            <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm border border-white rounded-full px-4 py-2 shadow-sm mb-6">
              <div className="flex">
                {[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}
              </div>
              <span className="text-xs font-black text-slate-700">
                {avgRating.toFixed(1)} · {reviews.length}+ reseñas
              </span>
            </div>

            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black text-slate-800 tracking-tight leading-[1.05] mb-6">
              Aprende idiomas{" "}
              <span className="bg-gradient-to-r from-pink-500 to-rose-400 bg-clip-text text-transparent">a tu ritmo</span>
            </h1>

            <p className="text-lg text-slate-500 leading-relaxed mb-8 max-w-xl mx-auto lg:mx-0">
              {isSingleTenant
                ? `Clases personalizadas 100% online con ${mainTeacher ? displayName(mainTeacher) : "una profesora certificada"}. Desde principiante hasta avanzado.`
                : platformTagline ||
                  `Clases 100% online con nuestro equipo de ${teachers.length || "varios"} profesores certificados, para cada objetivo y nivel.`}
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <Link href="/register" className="px-7 py-4 bg-gradient-to-r from-pink-500 to-rose-400 text-white font-bold text-sm rounded-2xl shadow-xl shadow-pink-200 hover:shadow-pink-300 active:scale-[0.97] transition-all duration-200 text-center">
                Empezar ahora
              </Link>
              {isSingleTenant && mainTeacher?.social_links?.whatsapp && (
                <button onClick={openWhatsApp} className="px-7 py-4 bg-white border-2 border-slate-200 text-slate-700 font-bold text-sm rounded-2xl hover:border-pink-300 hover:text-pink-600 transition-all duration-200 flex items-center justify-center gap-2 shadow-sm">
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
                  <p className="text-xl font-black text-slate-800">{stat.value}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Visual: foto única o collage de hasta 5 */}
          <div className="flex justify-center lg:justify-end animate-in fade-in slide-in-from-right-8 duration-700 delay-150">
            {isSingleTenant ? (
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-pink-400 to-rose-400 rounded-[3rem] blur-2xl opacity-30 scale-105" />
                <div className="relative w-72 h-80 sm:w-80 sm:h-96 rounded-[3rem] overflow-hidden border-4 border-white shadow-2xl shadow-pink-200">
                  <TeacherAvatar teacher={mainTeacher} className="w-full h-full object-cover" />
                </div>

                <div className="absolute -bottom-4 -left-4 bg-white/90 backdrop-blur-xl rounded-2xl px-4 py-3 shadow-xl shadow-slate-200/60 border border-white">
                  <div className="flex items-center gap-2">
                    <div className="flex">{[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}</div>
                    <span className="text-sm font-black text-slate-800">{avgRating.toFixed(1)}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5">{reviews.length} reseñas verificadas</p>
                </div>

                <div className="absolute -top-4 -right-4 bg-white/90 backdrop-blur-xl rounded-2xl px-4 py-3 shadow-xl shadow-slate-200/60 border border-white flex items-center gap-2">
                  <div className="w-8 h-8 bg-pink-100 rounded-xl flex items-center justify-center"><Award className="w-4 h-4 text-pink-600" /></div>
                  <div>
                    <p className="text-xs font-black text-slate-800">Certificada</p>
                    <p className="text-[10px] text-slate-400 font-bold">Bilingüe</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="relative w-80 h-80">
                {teachers.slice(0, 5).map((t, i) => {
                  const positions = [
                    "top-0 left-8", "top-4 right-0", "bottom-8 left-0",
                    "bottom-0 right-8", "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
                  ];
                  const sizes = i === 4 ? "w-28 h-28 z-10" : "w-20 h-20";
                  return (
                    <div key={t.user_username} className={`absolute ${positions[i]} ${sizes} rounded-3xl overflow-hidden border-4 border-white shadow-xl shadow-pink-200/60`}>
                      <TeacherAvatar teacher={t} className="w-full h-full object-cover" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-slate-400 animate-bounce z-10">
          <span className="text-[10px] font-bold uppercase tracking-widest">Ver más</span>
          <ChevronDown className="w-4 h-4" />
        </div>
      </section>

      {/* ─── Sobre nosotros / equipo ─── */}
      <section id="about" className="py-24 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-[400px] h-[400px] bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <p className="text-[10px] font-black text-pink-500 uppercase tracking-widest mb-3">
              {isSingleTenant ? "Sobre mí" : "Nuestro equipo"}
            </p>
            <h2 className="text-4xl sm:text-5xl font-black text-slate-800 tracking-tight mb-4">
              {isSingleTenant ? "Conoce a tu profesora" : "Conoce a nuestros profesores"}
            </h2>
            <p className="text-slate-500 max-w-xl mx-auto leading-relaxed">
              {isSingleTenant
                ? "Una apasionada del idioma con años de experiencia enseñando a estudiantes de todos los niveles y países."
                : "Un equipo de profesores certificados, cada uno con su propia especialidad, listos para acompañarte."}
            </p>
          </div>

          {loading ? (
            <div className="h-64 bg-white/60 rounded-[2rem] animate-pulse" />
          ) : isSingleTenant ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
              <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl shadow-slate-200/50 p-8">
                <p className="text-slate-600 leading-relaxed text-base mb-6">
                  {mainTeacher?.bio ?? "Profesora certificada y bilingüe con pasión por enseñar de forma personalizada. Mi metodología se adapta a tus objetivos y ritmo de aprendizaje."}
                </p>
                {mainTeacher?.skills?.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-6">
                    {mainTeacher.skills.map((s: string) => (
                      <span key={s} className="px-3 py-1.5 bg-pink-50 border border-pink-100 text-pink-700 text-xs font-bold rounded-xl">{s}</span>
                    ))}
                  </div>
                )}
                {mainTeacher?.certificates?.length > 0 && (
                  <div className="space-y-2">
                    {mainTeacher.certificates.map((c: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 bg-amber-50 rounded-xl px-4 py-3">
                        <Award className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        <span className="text-sm font-bold text-slate-700">{c.title}</span>
                        <span className="ml-auto text-xs font-black text-slate-400">{c.year}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {[
                  { value: "100%", label: "Online", sub: "Desde cualquier lugar", icon: <Globe className="w-6 h-6 text-pink-500" />, bg: "bg-pink-50 border-pink-100" },
                  { value: avgRating.toFixed(1), label: "Rating", sub: `${reviews.length} reseñas`, icon: <Star className="w-6 h-6 text-amber-500 fill-amber-500" />, bg: "bg-amber-50 border-amber-100" },
                  { value: `${combinedLanguages.length || 2}+`, label: "Idiomas", sub: combinedLanguages.slice(0,2).join(" · ") || "Inglés · Español", icon: <BookOpen className="w-6 h-6 text-purple-500" />, bg: "bg-purple-50 border-purple-100" },
                  { value: "50+", label: "Estudiantes", sub: "De 10+ países", icon: <Users className="w-6 h-6 text-emerald-500" />, bg: "bg-emerald-50 border-emerald-100" },
                ].map(stat => (
                  <div key={stat.label} className={`${stat.bg} border rounded-[1.5rem] p-6 flex flex-col items-center text-center`}>
                    <div className="mb-3">{stat.icon}</div>
                    <p className="text-3xl font-black text-slate-800 leading-none">{stat.value}</p>
                    <p className="text-sm font-black text-slate-700 mt-1">{stat.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{stat.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {teachers.map(t => (
                <div key={t.user_username} className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl shadow-slate-200/50 p-6 flex flex-col items-center text-center hover:-translate-y-1 hover:shadow-2xl transition-all duration-300">
                  <div className="w-20 h-20 rounded-2xl overflow-hidden border-2 border-white shadow-lg mb-4">
                    <TeacherAvatar teacher={t} className="w-full h-full object-cover" />
                  </div>
                  <h3 className="font-black text-slate-800 text-base">{displayName(t)}</h3>
                  {t.title && <p className="text-xs text-slate-500 mt-1">{t.title}</p>}
                  {t.subjects?.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-1.5 mt-3">
                      {t.subjects.slice(0, 3).map(s => (
                        <span key={s} className="px-2.5 py-1 bg-pink-50 text-pink-600 text-[10px] font-bold rounded-lg">{s}</span>
                      ))}
                    </div>
                  )}
                  <Link href={`/teachers/${t.user_username}`} className="mt-4 text-xs font-bold text-pink-600 hover:text-pink-700 transition-colors">
                    Ver perfil →
                  </Link>
                </div>
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
        <section className="pb-12">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-wrap justify-center gap-3">
            {combinedSubjects.map(s => (
              <span key={s} className="px-4 py-2 bg-white border border-slate-100 shadow-sm text-slate-600 text-sm font-bold rounded-xl">
                {s}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ─── Planes ─── */}
      <section id="plans" className="py-24 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-pink-300/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <p className="text-[10px] font-black text-pink-500 uppercase tracking-widest mb-3">Planes y precios</p>
            <h2 className="text-4xl sm:text-5xl font-black text-slate-800 tracking-tight mb-4">Elige tu plan</h2>
            <p className="text-slate-500 max-w-xl mx-auto">Sin contratos. Sin letra pequeña. Solo aprendizaje.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {PACKAGES.map(pkg => (
              <div key={pkg.name} className={`relative bg-white/80 backdrop-blur-xl rounded-[2rem] border-2 ${pkg.border} shadow-xl flex flex-col p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${pkg.popular ? "shadow-pink-200/60" : "shadow-slate-200/50"}`}>
                {pkg.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-gradient-to-r from-pink-500 to-rose-400 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full shadow-md shadow-pink-200">Más popular</span>
                  </div>
                )}
                <div className="mb-5">
                  <h3 className={`text-lg font-black mb-1 ${pkg.accent}`}>{pkg.name}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-black text-slate-800">{pkg.price}</span>
                    <span className="text-slate-500 text-sm font-medium">{pkg.period}</span>
                  </div>
                </div>
                <div className="flex-1 space-y-3 mb-6">
                  {pkg.features.map(f => (
                    <div key={f} className="flex items-start gap-2">
                      <Check className={`w-4 h-4 flex-shrink-0 mt-0.5 ${pkg.popular ? "text-pink-500" : "text-emerald-500"}`} />
                      <span className="text-sm text-slate-600 font-medium">{f}</span>
                    </div>
                  ))}
                </div>
                <Link href="/register" className={`w-full py-3.5 text-sm font-bold text-center rounded-xl transition-all duration-200 block active:scale-[0.97] ${pkg.popular ? "bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-lg shadow-pink-200 hover:shadow-pink-300" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                  Elegir {pkg.name}
                </Link>
              </div>
            ))}
          </div>

          {isSingleTenant && mainTeacher?.social_links?.whatsapp && (
            <p className="text-center text-xs text-slate-400 font-bold mt-8">
              ¿Tienes dudas?{" "}
              <button onClick={openWhatsApp} className="text-pink-500 hover:text-pink-600 underline transition-colors">
                Escríbeme por WhatsApp
              </button>
            </p>
          )}
        </div>
      </section>

      {/* ─── Reseñas ─── */}
      <section id="reviews" className="py-24 relative overflow-hidden">
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <p className="text-[10px] font-black text-pink-500 uppercase tracking-widest mb-3">Testimonios</p>
            <h2 className="text-4xl sm:text-5xl font-black text-slate-800 tracking-tight mb-4">
              {isSingleTenant ? "Lo que dicen mis alumnos" : "Lo que dicen nuestros alumnos"}
            </h2>
            <div className="flex items-center justify-center gap-2">
              <div className="flex">{[1,2,3,4,5].map(i => <Star key={i} className="w-5 h-5 text-amber-400 fill-amber-400" />)}</div>
              <span className="text-slate-700 font-black">{avgRating.toFixed(1)}</span>
              <span className="text-slate-400 text-sm">({reviews.length} reseñas)</span>
            </div>
          </div>

          {reviews.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-400 font-bold">Sé el primero en dejar una reseña tras tu clase</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {reviews.slice(0, 6).map(r => (
                <div key={r.id} className="bg-white/80 backdrop-blur-xl rounded-2xl border border-white shadow-lg shadow-slate-100 p-6 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-400 to-rose-400 flex items-center justify-center flex-shrink-0">
                      <span className="text-white font-black text-sm">{r.student_name?.[0] ?? "?"}</span>
                    </div>
                    <div>
                      <p className="text-sm font-black text-slate-800">{r.student_name}</p>
                      <div className="flex">
                        {[1,2,3,4,5].map(i => (
                          <Star key={i} className={`w-3 h-3 ${i <= r.rating ? "text-amber-400 fill-amber-400" : "text-slate-300"}`} />
                        ))}
                      </div>
                    </div>
                    {!isSingleTenant && r.teacher_username && (
                      <span className="ml-auto text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-lg">
                        @{r.teacher_username}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed italic">&quot;{r.comment}&quot;</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ─── CTA Final ─── */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-pink-500 via-rose-500 to-pink-600 pointer-events-none" />
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-white/10 rounded-full blur-[80px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-white/5 rounded-full blur-[80px] pointer-events-none" />

        <div className="relative max-w-2xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-4xl sm:text-5xl font-black text-white tracking-tight mb-4">¿Listo para empezar?</h2>
          <p className="text-white/80 text-lg mb-8 leading-relaxed">
            Tu primera clase de prueba es gratuita. Sin compromisos, sin tarjeta de crédito.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register" className="px-8 py-4 bg-white text-pink-600 font-black text-sm rounded-2xl shadow-xl hover:shadow-2xl active:scale-[0.97] transition-all duration-200">
              Crear cuenta gratis
            </Link>
            {isSingleTenant && mainTeacher?.social_links?.whatsapp && (
              <button onClick={openWhatsApp} className="px-8 py-4 bg-white/20 backdrop-blur-sm text-white font-bold text-sm rounded-2xl border-2 border-white/30 hover:bg-white/30 transition-all duration-200 flex items-center justify-center gap-2">
                <MessageCircle className="w-4 h-4" /> Hablar por WhatsApp
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="bg-slate-900 text-white py-12 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg overflow-hidden">
                <Image src="/assets/logo.png" alt="Logo" width={32} height={32} className="object-contain" />
              </div>
              <span className="font-black text-lg">{platformName}</span>
            </div>
            <div className="flex gap-6 text-sm text-slate-400 font-bold">
              <Link href="/login" className="hover:text-white transition-colors">Iniciar sesión</Link>
              <Link href="/register" className="hover:text-white transition-colors">Registrarse</Link>
            </div>
          </div>
          <div className="border-t border-slate-800 mt-8 pt-8 text-center">
            <p className="text-slate-500 text-sm">© {new Date().getFullYear()} {platformName} · Todos los derechos reservados</p>
          </div>
        </div>
      </footer>

      <ChipiWidget screenName="main" />
    </div>
  );
}