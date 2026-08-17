import re


def normalize_phone(raw: str | None) -> str | None:
    """
    Normaliza un número de teléfono al formato canónico "+<código> <número>",
    ej. "+34 642185633".
    """
    if raw is None:
        return None

    raw = raw.strip()
    if not raw:
        return None

    if not raw.startswith("+"):
        raw = "+" + raw

    parts = raw.split(None, 1)
    country_code = parts[0]

    if not re.fullmatch(r"\+\d{1,4}", country_code):
        digits = re.sub(r"[^\d+]", "", raw)
        return digits or None

    rest_raw = parts[1] if len(parts) > 1 else ""
    rest = re.sub(r"\D", "", rest_raw)

    if not rest:
        return country_code

    return f"{country_code} {rest}"