"""
Idiomas que HABLA el usuario (Fase 8). Dato nuevo y separado de `TeacherProfile.languages`
(idiomas que el profesor ENSEÑA, usados en la busqueda de profesores).

Reglas (el servidor es la unica barrera real; el frontend solo ayuda):
- hasta MAX_LANGUAGES idiomas;
- cada uno de MIN_LEN a MAX_LEN caracteres, elegido del catalogo `spoken_languages` de system_catalogs;
- sin duplicados, sin distinguir mayusculas ni tildes ("Ingles" == "inglés");
- se guarda con la ortografia del catalogo (normalizado).
"""
import unicodedata

from sqlalchemy.orm import Session

from app.models.system_catalog import SystemCatalog

CATALOG_KEY = "spoken_languages"
MAX_LANGUAGES = 10
MIN_LEN = 2
MAX_LEN = 40

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


def get_catalog(db: Session) -> list[str]:
    row = db.query(SystemCatalog).filter(SystemCatalog.key == CATALOG_KEY).first()
    value = row.value if row and isinstance(row.value, list) else DEFAULT_SPOKEN_LANGUAGES
    return [v for v in value if isinstance(v, str) and v.strip()]


def normalize_spoken_languages(raw, catalog: list[str]) -> list[str]:
    """Valida y normaliza. Devuelve la lista con la ortografia del catalogo; lanza SpokenLanguagesError si no es valida."""
    if not isinstance(raw, list):
        raise SpokenLanguagesError("Los idiomas deben enviarse como una lista")
    if len(raw) > MAX_LANGUAGES:
        raise SpokenLanguagesError(f"Puedes indicar como máximo {MAX_LANGUAGES} idiomas")

    by_key = {_key(c): c for c in catalog}
    result: list[str] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, str):
            raise SpokenLanguagesError("Cada idioma debe ser un texto")
        text = item.strip()
        if not (MIN_LEN <= len(text) <= MAX_LEN):
            raise SpokenLanguagesError(f"Cada idioma debe tener entre {MIN_LEN} y {MAX_LEN} caracteres")
        k = _key(text)
        if k not in by_key:
            raise SpokenLanguagesError(f"«{text}» no es un idioma disponible")
        if k in seen:
            raise SpokenLanguagesError(f"«{by_key[k]}» está repetido")
        seen.add(k)
        result.append(by_key[k])
    return result
