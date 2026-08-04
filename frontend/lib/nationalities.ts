// Lista de nacionalidades con bandera generada por código ISO 3166-1 alpha-2.
// Se guarda el NOMBRE del país (no el código) en la BD, para que sea legible
// directamente en el perfil sin tener que resolver el código en cada vista.

export function countryCodeToFlag(countryCode: string): string {
  return countryCode
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

export interface NationalityOption {
  code: string;
  name: string;
  flag: string;
}

const COUNTRY_NAMES: Record<string, string> = {
  VE: "Venezuela", CO: "Colombia", PE: "Perú", MX: "México", US: "Estados Unidos",
  CL: "Chile", AR: "Argentina", BR: "Brasil", ES: "España", GB: "Reino Unido",
  FR: "Francia", DE: "Alemania", IT: "Italia", PT: "Portugal", JP: "Japón",
  CN: "China", KR: "Corea del Sur", CA: "Canadá", EC: "Ecuador", BO: "Bolivia",
  PY: "Paraguay", UY: "Uruguay", CR: "Costa Rica", PA: "Panamá", GT: "Guatemala",
  HN: "Honduras", SV: "El Salvador", NI: "Nicaragua", DO: "República Dominicana",
  CU: "Cuba", PR: "Puerto Rico", NL: "Países Bajos", BE: "Bélgica", CH: "Suiza",
  AT: "Austria", SE: "Suecia", NO: "Noruega", DK: "Dinamarca", FI: "Finlandia",
  PL: "Polonia", IE: "Irlanda", GR: "Grecia", TR: "Turquía", RU: "Rusia",
  IN: "India", AU: "Australia", NZ: "Nueva Zelanda", ZA: "Sudáfrica",
  EG: "Egipto", MA: "Marruecos", NG: "Nigeria", AE: "Emiratos Árabes Unidos",
  SA: "Arabia Saudita", IL: "Israel", PH: "Filipinas", TH: "Tailandia",
  VN: "Vietnam", ID: "Indonesia", MY: "Malasia", SG: "Singapur",
  HK: "Hong Kong", TW: "Taiwán", BD: "Bangladesh", PK: "Pakistán", LK: "Sri Lanka",
};

export const NATIONALITIES: NationalityOption[] = Object.entries(COUNTRY_NAMES)
  .map(([code, name]) => ({ code, name, flag: countryCodeToFlag(code) }))
  .sort((a, b) => a.name.localeCompare(b.name, "es"));

/** Busca la bandera a partir del nombre guardado en la BD (fallback: 🌐) */
export function getFlagForNationality(name?: string | null): string {
  if (!name) return "";
  const found = NATIONALITIES.find(n => n.name === name);
  return found?.flag ?? "🌐";
}