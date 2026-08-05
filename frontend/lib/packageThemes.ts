export interface PackageTheme {
  icon: string;
  color: string;
}

// Sugerencia automática por materia/idioma — el profesor puede sobreescribirla
export const SUBJECT_THEME_MAP: Record<string, PackageTheme> = {
  "Matematica":   { icon: "🔢", color: "#3b82f6" },
  "Lenguaje":     { icon: "📖", color: "#8b5cf6" },
  "Física":       { icon: "⚛️", color: "#6366f1" },
  "Musica":       { icon: "🎵", color: "#f59e0b" },
  "Quimica":      { icon: "🧪", color: "#10b981" },
  "Historia":     { icon: "🏛️", color: "#92400e" },
  "Arte":         { icon: "🎨", color: "#ec4899" },
  "Programación": { icon: "💻", color: "#475569" },
  "Ciencias":     { icon: "🔬", color: "#059669" },
  "Economía":     { icon: "📈", color: "#0891b2" },
  "Psicología":   { icon: "🧠", color: "#a855f7" },
  "Negocios":     { icon: "💼", color: "#1d4ed8" },
  "Español":      { icon: "🇪🇸", color: "#ef4444" },
  "Ingles":       { icon: "🇬🇧", color: "#2563eb" },
  "Frances":      { icon: "🇫🇷", color: "#3b82f6" },
  "Italiano":     { icon: "🇮🇹", color: "#16a34a" },
  "Portugues":    { icon: "🇵🇹", color: "#16a34a" },
  "Aleman":       { icon: "🇩🇪", color: "#f59e0b" },
};

export const DEFAULT_PACKAGE_THEME: PackageTheme = { icon: "📦", color: "#ec4899" };

export function getSuggestedTheme(subject: string): PackageTheme {
  return SUBJECT_THEME_MAP[subject] ?? DEFAULT_PACKAGE_THEME;
}

// Opciones para el selector manual de icono (independiente de la materia)
export const ICON_PICKER_OPTIONS = [
  "📦", "📚", "🎓", "✏️", "🗣️", "🎯", "⭐", "🚀", "💡", "🧩",
  "🔢", "📖", "⚛️", "🎵", "🧪", "🏛️", "🎨", "💻", "🔬", "📈",
  "🧠", "💼", "🇪🇸", "🇬🇧", "🇫🇷", "🇮🇹", "🇵🇹", "🇩🇪", "🌍", "📝",
];