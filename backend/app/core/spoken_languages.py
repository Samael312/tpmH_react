"""
Idiomas que HABLA el usuario (Fase 8). Dato nuevo y separado de `TeacherProfile.languages`
(idiomas que el profesor ENSEÑA, usados en la busqueda de profesores).

Reglas (el servidor es la unica barrera real; el frontend solo ayuda):
- hasta MAX_LANGUAGES idiomas;
- cada uno de MIN_LEN a MAX_LEN caracteres, elegido del catalogo `spoken_languages` de system_catalogs;
- sin duplicados, sin distinguir mayusculas ni tildes ("Ingles" == "inglés");
- se guarda con la ortografia del catalogo (normalizado).
Fase 10: cada idioma lleva su NIVEL. Formato guardado: [{"language": "Inglés", "level": "fluent"}, ...] con
level en LEVELS. Los datos de la Fase 8 eran textos sueltos: al leerlos se muestran con level = null
(`read_spoken_languages`) y el usuario puede completarlo; al GUARDAR el nivel es obligatorio.
"""
import unicodedata

from sqlalchemy.orm import Session

from app.models.system_catalog import SystemCatalog

CATALOG_KEY = "spoken_languages"
MAX_LANGUAGES = 10
MIN_LEN = 2
MAX_LEN = 40

# Del mas alto al mas bajo.
LEVELS = ("native", "fluent", "intermediate", "basic")

# Se usa solo si la fila del catalogo aun no existe (migracion sin aplicar).
DEFAULT_SPOKEN_LANGUAGES = [
    "Español", "Inglés", "Portugués", "Francés", "Italiano", "Alemán",
    "Chino", "Árabe", "Ruso", "Japonés", "Coreano", "Neerlandés",
]


class SpokenLanguagesError(ValueError):
    """Entrada invalida; el mensaje es apto para mostrar al usuario (HTTP 422)."""


def _key(text: str) -> str:
    """Clave de comparacion: sin tildes, sin mayusculas, sin espacios sobrantes."""
    decomposed = unicodedata.normalize("NFKD", text.strip())
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def language_key(text: str) -> str:
    """Clave pública para comparar nombres de idioma (sin tildes, sin mayúsculas, sin espacios sobrantes)."""
    return _key(text)


def find_in_catalog(language: str, catalog: list[str]) -> str | None:
    """El nombre del catálogo que coincide con `language` (ortografía del catálogo), o None si no está."""
    k = _key(language)
    return next((name for name in catalog if _key(name) == k), None)


def get_catalog(db: Session) -> list[str]:
    row = db.query(SystemCatalog).filter(SystemCatalog.key == CATALOG_KEY).first()
    value = row.value if row and isinstance(row.value, list) else DEFAULT_SPOKEN_LANGUAGES
    return [v for v in value if isinstance(v, str) and v.strip()]


def read_spoken_languages(raw) -> list[dict]:
    """Lee lo guardado (formato nuevo o textos sueltos de la Fase 8) como [{language, level|None}]. Nunca lanza."""
    out: list[dict] = []
    for item in raw if isinstance(raw, list) else []:
        if isinstance(item, str) and item.strip():
            out.append({"language": item.strip(), "level": None})
        elif isinstance(item, dict) and isinstance(item.get("language"), str) and item["language"].strip():
            level = item.get("level")
            out.append({"language": item["language"].strip(), "level": level if level in LEVELS else None})
    return out


def language_names(raw) -> list[str]:
    return [i["language"] for i in read_spoken_languages(raw)]


def speaks(raw, language: str) -> bool:
    """True si la lista incluye ese idioma (sin distinguir mayusculas ni tildes)."""
    k = _key(language)
    return any(_key(n) == k for n in language_names(raw))


def normalize_spoken_languages(raw, catalog: list[str]) -> list[dict]:
    """
    Valida y normaliza. Devuelve [{language, level}] con la ortografia del catalogo; lanza SpokenLanguagesError si no
    es valida. Cada elemento debe ser {"language": ..., "level": ...} con un nivel de LEVELS.
    """
    if not isinstance(raw, list):
        raise SpokenLanguagesError("Los idiomas deben enviarse como una lista")
    if len(raw) > MAX_LANGUAGES:
        raise SpokenLanguagesError(f"Puedes indicar como máximo {MAX_LANGUAGES} idiomas")

    by_key = {_key(c): c for c in catalog}
    result: list[dict] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise SpokenLanguagesError("Cada idioma debe indicar el idioma y su nivel")
        name = item.get("language")
        if not isinstance(name, str):
            raise SpokenLanguagesError("Cada idioma debe ser un texto")
        text = name.strip()
        if not (MIN_LEN <= len(text) <= MAX_LEN):
            raise SpokenLanguagesError(f"Cada idioma debe tener entre {MIN_LEN} y {MAX_LEN} caracteres")
        k = _key(text)
        if k not in by_key:
            raise SpokenLanguagesError(f"«{text}» no es un idioma disponible")
        if k in seen:
            raise SpokenLanguagesError(f"«{by_key[k]}» está repetido")
        level = item.get("level")
        if level not in LEVELS:
            raise SpokenLanguagesError(f"Indica tu nivel en {by_key[k]} (nativo, fluido, intermedio o básico)")
        seen.add(k)
        result.append({"language": by_key[k], "level": level})
    return result
