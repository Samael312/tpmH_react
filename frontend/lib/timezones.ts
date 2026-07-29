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

export const DEFAULT_COUNTRY = { flag: "🌐", dialCode: "" };