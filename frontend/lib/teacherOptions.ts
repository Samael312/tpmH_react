// Opciones compartidas de perfil de profesor.
// Fuente única de verdad — se usa en onboarding, edición de perfil y
// creación de paquetes, para no duplicar estas listas en cada archivo.

export const SUBJECTS = [
  "Matematica", "Lenguaje", "Física", "Musica", "Quimica", "Historia",
  "Arte", "Programación", "Ciencias", "Economía", "Psicología", "Negocios",
];

export const LANGUAGES = [
  "Español", "Ingles", "Frances", "Italiano", "Portugues", "Aleman",
];

export const SKILL_SUGGESTIONS = [
  "Gramática", "Conversación", "Pronunciación", "Vocabulario",
  "Business English", "IELTS", "TOEFL", "Niños", "Viajes", "Redacción",
];

export const GOALS = [
  { text: "Conversaciones cotidianas", desc: "Hablar de temas del día a día", icon: "🗣️" },
  { text: "Mejorar pronunciación", desc: "Fluidez y acento natural", icon: "🎙️" },
  { text: "Ampliar vocabulario", desc: "Palabras para situaciones reales", icon: "📚" },
  { text: "Comprender audios/videos", desc: "Entender a hablantes nativos", icon: "🎧" },
  { text: "Preparar exámenes", desc: "TOEFL, IELTS, Cambridge, etc.", icon: "📝" },
  { text: "Viajar al extranjero", desc: "Sobrevivir en otro país en inglés", icon: "✈️" },
];

export const PAYMENT_METHODS =  [
  { value: "Paypal",       label: "PayPal",             icon: "💳", color: "text-blue-600" },
  { value: "Binance",      label: "Binance (USDT)",     icon: "🔶", color: "text-yellow-500" },
  { value: "Zelle",        label: "Zelle",              icon: "💜", color: "text-purple-600" },
  { value: "BankTransfer", label: "Transferencia bancaria", icon: "🏦", color: "text-emerald-600" },
  { value: "MobilePayment", label: "Pago móvil/Bizum",  icon: "📱", color: "text-pink-600" },
];

export const TOPICS = [
  'Grammar','Reading','Exercises','Vocabulary'
];

export const LEVELS = ['A1','A2','B1','B2','C1','C2'];