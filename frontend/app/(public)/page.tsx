import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center bg-slate-50 overflow-hidden font-sans selection:bg-pink-500 selection:text-white">
      
      {/* ─── FONDOS DECORATIVOS (Blobs) ─── */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-pink-300/20 rounded-full blur-[120px] pointer-events-none animate-pulse" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-rose-300/20 rounded-full blur-[120px] pointer-events-none" />

      {/* ─── CONTENEDOR PRINCIPAL ─── */}
      <div className="relative z-10 w-full max-w-lg p-6 animate-fade-in-up">
        <div className="bg-white/80 backdrop-blur-2xl p-10 sm:p-14 rounded-[3rem] shadow-2xl shadow-slate-200/50 border border-white text-center flex flex-col items-center">
          
          {/* Logo Animado */}
          <div className="w-24 h-24 bg-gradient-to-br from-pink-500 to-rose-400 rounded-[2rem] flex items-center justify-center shadow-xl shadow-pink-200 mb-8 transform hover:rotate-12 hover:scale-105 transition-all duration-500 ease-out">
            <span className="text-white text-5xl font-black drop-shadow-md">T</span>
          </div>

          {/* Textos */}
          <h1 className="text-4xl sm:text-5xl font-black text-slate-800 tracking-tight font-display mb-4">
            TuProfeMaria
          </h1>
          <p className="text-base sm:text-lg font-medium text-slate-500 mb-10 max-w-sm leading-relaxed">
            La plataforma moderna y exclusiva de clases particulares para potenciar tu aprendizaje.
          </p>

          {/* Botones de Acción */}
          <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
            <Link 
              href="/login" 
              className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500 text-white font-bold text-sm md:text-base rounded-2xl shadow-lg shadow-pink-200 hover:shadow-pink-300 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-300 flex items-center justify-center gap-2"
            >
              Iniciar sesión
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
            
            <Link 
              href="/register" 
              className="w-full sm:w-auto px-8 py-4 bg-pink-50 text-pink-600 hover:bg-pink-100 hover:text-pink-700 font-bold text-sm md:text-base rounded-2xl transition-colors duration-300 flex items-center justify-center"
            >
              Crear cuenta
            </Link>
          </div>
          
        </div>

        {/* Footer sutil */}
        <p className="text-center text-xs font-bold text-slate-400 uppercase tracking-widest mt-10">
          © {new Date().getFullYear()} TPMH Platform
        </p>
      </div>
    </main>
  );
}