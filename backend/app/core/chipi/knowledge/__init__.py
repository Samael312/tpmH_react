"""Conocimiento de Chipi: fichas .md por pantalla (screens/) y por tema (topics/).

Cada ficha lleva un frontmatter simple (roles, keywords, summary) y un cuerpo en Markdown.
Se cargan una vez y se cachean. Una ficha rota se omite y se registra; `validate_cards`
(usado en tests) la reporta como error.
"""
from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional

logger = logging.getLogger(__name__)

KIND = Literal["screens", "topics"]
BASE_DIR = Path(__file__).parent
ALL_ROLES = frozenset({"public", "student", "teacher", "teacher_admin", "superadmin"})

MAX_SCREEN_CHARS = 1500
MAX_TOPIC_CHARS = 2000
MAX_TOPIC_INDEX_CHARS = 3000
MAX_TOPICS_PER_MESSAGE = 3
TOPIC_HEADERS = ("## Regla", "## Casos límite", "## Cuándo escalar")


@dataclass(frozen=True)
class Card:
    slug: str
    roles: frozenset
    keywords: tuple
    summary: str
    body: str


def _parse_list(value: str) -> list[str]:
    value = value.strip()
    if not (value.startswith("[") and value.endswith("]")):
        raise ValueError(f"lista mal formada: {value!r}")
    return [item.strip() for item in value[1:-1].split(",") if item.strip()]


def _parse_card(slug: str, text: str) -> Card:
    match = re.match(r"\A---\s*\n(.*?)\n---\s*\n?(.*)\Z", text, re.DOTALL)
    if not match:
        raise ValueError("falta el frontmatter (--- ... ---)")
    meta: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition(":")
        if not sep:
            raise ValueError(f"línea de frontmatter inválida: {line!r}")
        meta[key.strip()] = value.strip()
    roles = frozenset(_parse_list(meta["roles"])) if "roles" in meta else ALL_ROLES
    unknown = roles - ALL_ROLES
    if unknown:
        raise ValueError(f"roles desconocidos: {sorted(unknown)}")
    keywords = tuple(_parse_list(meta["keywords"])) if "keywords" in meta else ()
    summary = meta.get("summary", "")
    if not summary:
        raise ValueError("falta summary")
    return Card(slug=slug, roles=roles, keywords=keywords, summary=summary, body=match.group(2).strip())


def _read_dir(kind: str, base: Path, errors: Optional[list] = None) -> dict[str, Card]:
    cards: dict[str, Card] = {}
    folder = base / kind
    if not folder.is_dir():
        return cards
    for path in sorted(folder.glob("*.md")):
        try:
            cards[path.stem] = _parse_card(path.stem, path.read_text(encoding="utf-8"))
        except (ValueError, OSError) as exc:
            logger.error("Chipi: ficha %s/%s omitida: %s", kind, path.name, exc)
            if errors is not None:
                errors.append(f"{kind}/{path.stem}: {exc}")
    return cards


@lru_cache(maxsize=None)
def _cached(kind: str) -> dict[str, Card]:
    return _read_dir(kind, BASE_DIR)


def load_cards(kind: KIND, base: Optional[Path] = None) -> dict[str, Card]:
    """Fichas por slug. `base` solo para tests (sin caché)."""
    return _cached(kind) if base is None else _read_dir(kind, base)


def get_screen_card(screen: str, role: Optional[str], base: Optional[Path] = None) -> str:
    card = load_cards("screens", base).get(screen)
    if card is None or (role or "public") not in card.roles:
        return ""
    return card.body


def all_screen_keys(base: Optional[Path] = None) -> set[str]:
    return set(load_cards("screens", base))


def validate_cards(base: Optional[Path] = None) -> list[str]:
    """Errores de todas las fichas (lista vacía = todo bien)."""
    base = base or BASE_DIR
    errors: list[str] = []
    for kind, limit in (("screens", MAX_SCREEN_CHARS), ("topics", MAX_TOPIC_CHARS)):
        for slug, card in _read_dir(kind, base, errors).items():
            if len(card.body) > limit:
                errors.append(f"{kind}/{slug}: cuerpo de {len(card.body)} caracteres (tope {limit})")
            if kind == "topics":
                if not card.keywords:
                    errors.append(f"{kind}/{slug}: sin keywords")
                for header in TOPIC_HEADERS:
                    if header not in card.body:
                        errors.append(f"{kind}/{slug}: falta la cabecera «{header}»")
    return errors


# ─── Temas: índice y selección por palabras clave ────────────────────────────

def normalize(text: str) -> str:
    """Minúsculas, sin tildes y con los espacios colapsados."""
    decomposed = unicodedata.normalize("NFD", (text or "").lower())
    plain = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", plain).strip()


def _visible_topics(role: Optional[str], base: Optional[Path]) -> list[Card]:
    return [c for c in load_cards("topics", base).values() if (role or "public") in c.roles]


def get_topic_index(role: Optional[str], base: Optional[Path] = None) -> str:
    """Una línea `- slug: resumen` por tema visible al rol (tope MAX_TOPIC_INDEX_CHARS)."""
    lines: list[str] = []
    size = 0
    for card in sorted(_visible_topics(role, base), key=lambda c: c.slug):
        line = f"- {card.slug}: {card.summary}"
        if size + len(line) + 1 > MAX_TOPIC_INDEX_CHARS:
            break
        lines.append(line)
        size += len(line) + 1
    return "\n".join(lines)


def pick_topics(role: Optional[str], text: str, limit: int = MAX_TOPICS_PER_MESSAGE,
                base: Optional[Path] = None) -> list[Card]:
    """Fichas del rol cuyo texto de palabras clave aparece en `text`, la de más coincidencias primero."""
    haystack = normalize(text)
    if not haystack:
        return []
    scored: list[tuple[int, str, Card]] = []
    for card in _visible_topics(role, base):
        score = sum(
            1 for kw in card.keywords
            if kw and re.search(r"(?<!\w)" + re.escape(normalize(kw)), haystack)
        )
        if score:
            scored.append((score, card.slug, card))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [card for _, _, card in scored[:limit]]


def render_topics(cards: list[Card]) -> str:
    return "\n\n".join(f"TEMA: {c.slug}\n{c.body}" for c in cards)
