// frontend/lib/timezones.ts
export const TIMEZONE_OPTIONS = [
  { value: "America/Caracas",     flag: "🇻🇪", label: "Caracas" },
  { value: "America/Bogota",      flag: "🇨🇴", label: "Bogotá" },
  { value: "America/Lima",        flag: "🇵🇪", label: "Lima" },
  { value: "America/Mexico_City", flag: "🇲🇽", label: "Ciudad de México" },
  { value: "America/New_York",    flag: "🇺🇸", label: "Nueva York" },
  { value: "America/Los_Angeles", flag: "🇺🇸", label: "Los Ángeles" },
  { value: "America/Santiago",    flag: "🇨🇱", label: "Santiago" },
  { value: "America/Buenos_Aires",flag: "🇦🇷", label: "Buenos Aires" },
  { value: "America/Sao_Paulo",   flag: "🇧🇷", label: "São Paulo" },
  { value: "America/Chicago",     flag: "🇺🇸", label: "Chicago" },
  { value: "Europe/Madrid",       flag: "🇪🇸", label: "Madrid" },
  { value: "Europe/London",       flag: "🇬🇧", label: "Londres" },
  { value: "Europe/Paris",        flag: "🇫🇷", label: "París" },
  { value: "Asia/Tokyo",          flag: "🇯🇵", label: "Tokio" },
  { value: "Asia/Dubai",          flag: "🇦🇪", label: "Dubái" },
  { value: "UTC",                 flag: "🌐", label: "UTC" },
];


// ─── Mapeo de timezone a bandera + código de país ────────────────────────────
export const TIMEZONE_TO_COUNTRY: Record<string, { flag: string; dialCode: string }> = {
  "America/Caracas":      { flag: "🇻🇪", dialCode: "+58" },
  "America/Bogota":       { flag: "🇨🇴", dialCode: "+57" },
  "America/Lima":         { flag: "🇵🇪", dialCode: "+51" },
  "America/Mexico_City":  { flag: "🇲🇽", dialCode: "+52" },
  "America/New_York":     { flag: "🇺🇸", dialCode: "+1" },
  "America/Los_Angeles":  { flag: "🇺🇸", dialCode: "+1" },
  "America/Santiago":     { flag: "🇨🇱", dialCode: "+56" },
  "America/Buenos_Aires": { flag: "🇦🇷", dialCode: "+54" },
  "America/Sao_Paulo":    { flag: "🇧🇷", dialCode: "+55" },
  "America/Chicago":      { flag: "🇺🇸", dialCode: "+1" },
  "Europe/Madrid":        { flag: "🇪🇸", dialCode: "+34" },
  "Europe/London":        { flag: "🇬🇧", dialCode: "+44" },
  "Europe/Paris":         { flag: "🇫🇷", dialCode: "+33" },
  "Asia/Tokyo":           { flag: "🇯🇵", dialCode: "+81" },
  "Asia/Dubai":           { flag: "🇦🇪", dialCode: "+971" },
  "UTC":                  { flag: "🌐", dialCode: "" },
};

export const DEFAULT_COUNTRY = { flag: "🇻🇪", dialCode: "+58" };

export interface CountryInfo {
  flag: string;
  dialCode: string;
}

// Lista única de códigos de país disponibles para el selector de teléfono
export const COUNTRY_OPTIONS: CountryInfo[] = (() => {
  const map = new Map<string, CountryInfo>();
  Object.values(TIMEZONE_TO_COUNTRY).forEach((c) => {
    if (c?.dialCode) map.set(c.dialCode, c);
  });
  if (DEFAULT_COUNTRY?.dialCode) map.set(DEFAULT_COUNTRY.dialCode, DEFAULT_COUNTRY);
  return Array.from(map.values());
})();

/**
 * Separa un teléfono guardado ("+58 4120000000") en código de país + resto.
 * Si no se reconoce ningún código al inicio, cae en DEFAULT_COUNTRY y deja
 * el número completo en "rest" (fallback mientras la base de datos tenga
 * números sin formato consistente).
 */
export function parsePhoneNumber(fullPhone: string | null | undefined): {
  country: CountryInfo;
  rest: string;
} {
  if (!fullPhone) return { country: DEFAULT_COUNTRY, rest: "" };
  const trimmed = fullPhone.trim();
  const sorted = [...COUNTRY_OPTIONS].sort((a, b) => b.dialCode.length - a.dialCode.length);
  for (const c of sorted) {
    if (trimmed.startsWith(c.dialCode)) {
      return { country: c, rest: trimmed.slice(c.dialCode.length).trim() };
    }
  }
  return { country: DEFAULT_COUNTRY, rest: trimmed };
}