// Mascota de Chipi en 2D, animada con CSS (sin dependencias de three.js).
// El archivo public/models/Chipi_Waving.glb solo trae el esqueleto/animación
// de saludo pero sin malla ni materiales, así que no hay nada que renderizar
// en 3D todavía. Este componente reconstruye al mismo personaje del logo
// (/assets/logo.png: perrito con lentes y corbata) de cuerpo entero, saludando
// en loop, para no bloquear la sección mientras se re-exporta el modelo.
//
// El brazo que saluda es un <g> aparte con transform-origin en el hombro
// (222px 222px, en el espacio de coordenadas del viewBox) animado con la
// utilidad `animate-wave` — mismo mecanismo que cualquier otra animación
// CSS del proyecto, nada de JS por frame.
export default function ChipiMascot() {
  return (
    <div className="relative w-full max-w-[280px] mx-auto">
      {/* Resplandor detrás de la mascota */}
      <div className="absolute -inset-8 bg-gradient-to-br from-pink-500/30 via-rose-500/20 to-purple-500/30 rounded-full blur-2xl scale-90 animate-pulse pointer-events-none" />
      {/* Anillo punteado decorativo */}
      <div className="absolute inset-2 rounded-full border-2 border-dashed border-pink-400/25 animate-spin-slow pointer-events-none" />

      <div className="relative animate-float">
        <svg viewBox="0 0 320 400" className="w-full h-auto drop-shadow-xl" aria-hidden="true">
          {/* Sombra en el piso */}
          <ellipse cx="160" cy="382" rx="72" ry="13" fill="#1E293B" opacity="0.12" />

          {/* Pies */}
          <ellipse cx="130" cy="352" rx="22" ry="15" fill="#FFF8ED" stroke="#1E293B" strokeWidth="6" />
          <ellipse cx="190" cy="352" rx="22" ry="15" fill="#FFF8ED" stroke="#1E293B" strokeWidth="6" />

          {/* Brazo en reposo */}
          <path d="M108,238 Q80,262 75,302" fill="none" stroke="#1E293B" strokeWidth="32" strokeLinecap="round" />
          <path d="M108,238 Q80,262 75,302" fill="none" stroke="#FFF8ED" strokeWidth="22" strokeLinecap="round" />
          <circle cx="75" cy="304" r="19" fill="#FFF8ED" stroke="#1E293B" strokeWidth="6" />

          {/* Orejas (detrás de la cabeza) */}
          <ellipse cx="78" cy="150" rx="34" ry="72" fill="#FFF8ED" stroke="#1E293B" strokeWidth="7" transform="rotate(-18 78 150)" />
          <ellipse cx="242" cy="150" rx="34" ry="72" fill="#FFF8ED" stroke="#1E293B" strokeWidth="7" transform="rotate(18 242 150)" />

          {/* Cuerpo */}
          <rect x="90" y="205" width="140" height="150" rx="58" fill="#FFF8ED" stroke="#1E293B" strokeWidth="7" />

          {/* Cuello de la camisa */}
          <path d="M118,210 L146,210 L138,233 L110,225 Z" fill="#CBD5E1" stroke="#1E293B" strokeWidth="4" strokeLinejoin="round" />
          <path d="M202,210 L230,210 L235,225 L207,233 Z" fill="#CBD5E1" stroke="#1E293B" strokeWidth="4" strokeLinejoin="round" />

          {/* Corbata */}
          <path d="M160,206 L150,220 L160,234 L170,220 Z" fill="#1E293B" />
          <path d="M160,222 L151,236 L160,318 L169,236 Z" fill="#1E293B" />

          {/* Brazo que saluda — pivote en el hombro (222, 222) */}
          <g style={{ transformOrigin: "222px 222px" }} className="animate-wave">
            <path d="M222,222 Q253,192 250,140" fill="none" stroke="#1E293B" strokeWidth="32" strokeLinecap="round" />
            <path d="M222,222 Q253,192 250,140" fill="none" stroke="#FFF8ED" strokeWidth="22" strokeLinecap="round" />
            <circle cx="250" cy="140" r="21" fill="#FFF8ED" stroke="#1E293B" strokeWidth="6" />
            <line x1="250" y1="117" x2="250" y2="102" stroke="#1E293B" strokeWidth="5" strokeLinecap="round" />
            <line x1="237" y1="123" x2="226" y2="110" stroke="#1E293B" strokeWidth="5" strokeLinecap="round" />
            <line x1="263" y1="123" x2="274" y2="110" stroke="#1E293B" strokeWidth="5" strokeLinecap="round" />
          </g>

          {/* Cabeza */}
          <circle cx="160" cy="120" r="90" fill="#FFF8ED" stroke="#1E293B" strokeWidth="7" />

          {/* Lentes */}
          <circle cx="130" cy="118" r="28" fill="#EAF2FB" stroke="#1E293B" strokeWidth="6" />
          <circle cx="190" cy="118" r="28" fill="#EAF2FB" stroke="#1E293B" strokeWidth="6" />
          <line x1="158" y1="118" x2="162" y2="118" stroke="#1E293B" strokeWidth="6" />
          <line x1="102" y1="112" x2="88" y2="107" stroke="#1E293B" strokeWidth="5" strokeLinecap="round" />
          <line x1="218" y1="112" x2="232" y2="107" stroke="#1E293B" strokeWidth="5" strokeLinecap="round" />

          {/* Ojos */}
          <circle cx="130" cy="118" r="6" fill="#1E293B" />
          <circle cx="190" cy="118" r="6" fill="#1E293B" />
          <circle cx="127.5" cy="115.5" r="1.8" fill="#ffffff" />
          <circle cx="187.5" cy="115.5" r="1.8" fill="#ffffff" />

          {/* Cachetes */}
          <ellipse cx="106" cy="150" rx="12" ry="7" fill="#FBCFE8" opacity="0.7" />
          <ellipse cx="214" cy="150" rx="12" ry="7" fill="#FBCFE8" opacity="0.7" />

          {/* Nariz y sonrisa */}
          <ellipse cx="160" cy="152" rx="10" ry="8" fill="#1E293B" />
          <path d="M144,166 Q160,180 176,166" stroke="#1E293B" strokeWidth="5" fill="none" strokeLinecap="round" />
        </svg>
      </div>

      {/* Destellos junto a la mano que saluda */}
      <span className="absolute top-[26%] right-[6%] w-2.5 h-2.5 rounded-full bg-pink-300 animate-ping" />
      <span className="absolute top-[18%] right-[16%] w-1.5 h-1.5 rounded-full bg-purple-300 animate-ping" style={{ animationDelay: "0.6s" }} />
    </div>
  );
}
