/**
 * Capitaliza la primera letra de cada palabra a medida que el usuario
 * escribe, sin tocar el resto de los caracteres ya tipeados (para no pelear
 * con el cursor ni forzar minúsculas en lo que el usuario ya escribió).
 * Usado en los campos de nombre/apellido de los formularios de registro.
 */
export function capitalizeWords(value: string): string {
  return value.replace(/(^|\s)([a-zà-öø-ÿ])/gi, (_m, sep: string, letter: string) => sep + letter.toUpperCase());
}
