"""Conocimiento de Chipi: fichas por pantalla y por tema (docs/superpowers/specs/2026-11-22-chipi-knowledge-design.md)."""
from pathlib import Path

from app.core.chipi import knowledge as kb


def _write(base: Path, kind: str, slug: str, text: str) -> None:
    folder = base / kind
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{slug}.md").write_text(text, encoding="utf-8")


CARD = """---
roles: [teacher, teacher_admin]
keywords: [paquete gratis, regalar]
summary: Regalar un paquete gratis.
---
## Regla
Texto.
"""


# ─── Task 1: cargador ────────────────────────────────────────────────────────

def test_load_cards_parses_frontmatter(tmp_path):
    _write(tmp_path, "topics", "t1", CARD)
    card = kb.load_cards("topics", base=tmp_path)["t1"]
    assert card.slug == "t1"
    assert card.roles == frozenset({"teacher", "teacher_admin"})
    assert card.keywords == ("paquete gratis", "regalar")
    assert card.summary == "Regalar un paquete gratis."
    assert card.body.startswith("## Regla")


def test_missing_roles_means_all_roles(tmp_path):
    _write(tmp_path, "screens", "s1", "---\nsummary: x\n---\n## Qué es\nHola\n")
    card = kb.load_cards("screens", base=tmp_path)["s1"]
    assert card.roles == kb.ALL_ROLES


def test_get_screen_card_filters_by_role(tmp_path):
    _write(tmp_path, "screens", "s1", "---\nroles: [superadmin]\nsummary: x\n---\nSolo admin\n")
    assert kb.get_screen_card("s1", "student", base=tmp_path) == ""
    assert kb.get_screen_card("s1", "superadmin", base=tmp_path) == "Solo admin"


def test_unknown_screen_returns_empty(tmp_path):
    assert kb.get_screen_card("no-existe", "student", base=tmp_path) == ""
    assert kb.get_screen_card("no-existe", None, base=tmp_path) == ""


def test_broken_frontmatter_is_skipped_not_raised(tmp_path):
    _write(tmp_path, "topics", "roto", "sin frontmatter\n")
    _write(tmp_path, "topics", "ok", CARD)
    assert set(kb.load_cards("topics", base=tmp_path)) == {"ok"}


def test_validate_cards_reports_broken_frontmatter_and_oversize(tmp_path):
    _write(tmp_path, "topics", "roto", "sin frontmatter\n")
    _write(tmp_path, "screens", "grande", "---\nsummary: x\n---\n" + "a" * 1600)
    errors = kb.validate_cards(base=tmp_path)
    assert any("roto" in e for e in errors)
    assert any("grande" in e for e in errors)


# ─── Task 2: índice de temas y selección por palabras clave ──────────────────

def _topic(roles: str, keywords: str, summary: str = "Resumen.") -> str:
    return f"---\nroles: [{roles}]\nkeywords: [{keywords}]\nsummary: {summary}\n---\n## Regla\nx\n"


def test_pick_topics_ignores_case_and_accents(tmp_path):
    _write(tmp_path, "topics", "gratis", _topic("teacher", "paquete gratis, regalar"))
    found = kb.pick_topics("teacher", "¿PUEDO REGALAR un PAQUETE GRÁTIS?", base=tmp_path)
    assert [c.slug for c in found] == ["gratis"]


def test_pick_topics_empty_text_returns_empty(tmp_path):
    _write(tmp_path, "topics", "gratis", _topic("teacher", "paquete gratis"))
    assert kb.pick_topics("teacher", "", base=tmp_path) == []
    assert kb.pick_topics("teacher", "   ", base=tmp_path) == []


def test_pick_topics_respects_limit_and_score_order(tmp_path):
    _write(tmp_path, "topics", "a", _topic("student", "pago"))
    _write(tmp_path, "topics", "b", _topic("student", "pago, rechazado"))
    _write(tmp_path, "topics", "c", _topic("student", "pago, rechazado, comprobante"))
    _write(tmp_path, "topics", "d", _topic("student", "pago"))
    found = kb.pick_topics("student", "mi pago fue rechazado, adjunté el comprobante", base=tmp_path)
    assert [c.slug for c in found] == ["c", "b", "a"]


def test_pick_topics_filters_by_role(tmp_path):
    _write(tmp_path, "topics", "retiro", _topic("teacher", "retiro"))
    assert kb.pick_topics("student", "quiero hacer un retiro", base=tmp_path) == []
    assert kb.pick_topics(None, "quiero hacer un retiro", base=tmp_path) == []
    assert [c.slug for c in kb.pick_topics("teacher", "quiero hacer un retiro", base=tmp_path)] == ["retiro"]


def test_topic_index_only_lists_visible_topics(tmp_path):
    _write(tmp_path, "topics", "mio", _topic("student", "x", "Cosa del alumno."))
    _write(tmp_path, "topics", "ajeno", _topic("superadmin", "y", "Cosa del admin."))
    index = kb.get_topic_index("student", base=tmp_path)
    assert "mio: Cosa del alumno." in index
    assert "ajeno" not in index
    assert kb.get_topic_index("public", base=tmp_path) == ""


# ─── Task 3: prompt por capas y política de soporte ──────────────────────────

import pytest

from app.core.chipi import prompts as chipi_prompts


def _card(slug, roles, keywords=(), summary="Resumen.", body="## Regla\nx"):
    return kb.Card(slug=slug, roles=frozenset(roles), keywords=tuple(keywords), summary=summary, body=body)


@pytest.fixture
def fake_knowledge(monkeypatch):
    screens = {"materials_teacher": _card("materials_teacher", kb.ALL_ROLES, body="FICHA-MATERIALES")}
    topics = {
        "teacher__paquete-gratis": _card("teacher__paquete-gratis", {"teacher", "teacher_admin"},
                                         ["paquete gratis", "regalar"], "Regalar un paquete.", "FICHA-GRATIS"),
        "admin__comisiones": _card("admin__comisiones", {"superadmin"}, ["comision", "retiro"],
                                   "Comisiones.", "FICHA-DINERO-ADMIN"),
    }
    monkeypatch.setattr(kb, "load_cards", lambda kind, base=None: screens if kind == "screens" else topics)


def _prompt(role, screen="materials_teacher", text="", turns=1):
    return chipi_prompts.build_system_prompt(role=role, screen=screen, user_text=text, user_turns=turns)


@pytest.mark.parametrize("role", ["student", "teacher", "teacher_admin"])
def test_non_superadmin_prompts_have_escalation(fake_knowledge, role):
    prompt = _prompt(role)
    assert "Habla con soporte" in prompt and "Nuevo ticket" in prompt


def test_superadmin_prompt_has_no_support_escalation(fake_knowledge):
    prompt = _prompt("superadmin")
    for phrase in ("Habla con soporte", "Nuevo ticket", "crear un ticket"):
        assert phrase not in prompt
    assert "eres el soporte" in prompt


def test_escalation_threshold(fake_knowledge):
    assert "lleva 2 mensajes" in _prompt("student", turns=2)
    assert "ORDEN: propón" not in _prompt("student", turns=2)
    assert "ORDEN: propón" in _prompt("student", turns=3)


def test_topic_from_other_screen_is_included(fake_knowledge):
    prompt = _prompt("teacher", screen="materials_teacher", text="¿Puedo REGALAR un paquete gratis?")
    assert "FICHA-MATERIALES" in prompt and "FICHA-GRATIS" in prompt
    assert "teacher__paquete-gratis: Regalar un paquete." in prompt  # índice


def test_student_does_not_get_other_role_topics(fake_knowledge):
    prompt = _prompt("student", text="¿cómo funciona la comisión y el retiro? quiero regalar un paquete gratis")
    assert "FICHA-DINERO-ADMIN" not in prompt and "FICHA-GRATIS" not in prompt


def test_unknown_screen_and_empty_text_do_not_break(fake_knowledge):
    prompt = _prompt("teacher", screen="pantalla-inventada", text="")
    assert "FICHA-MATERIALES" not in prompt and "FICHA-GRATIS" not in prompt


def test_prompt_size_under_budget(monkeypatch):
    big_screen = _card("big", kb.ALL_ROLES, body="a" * kb.MAX_SCREEN_CHARS)
    topics = {f"t{i}": _card(f"t{i}", {"teacher"}, ["paquete"], "r" * 150, "b" * kb.MAX_TOPIC_CHARS) for i in range(20)}
    monkeypatch.setattr(kb, "load_cards", lambda kind, base=None: {"big": big_screen} if kind == "screens" else topics)
    prompt = _prompt("teacher", screen="big", text="paquete", turns=5)
    assert len(prompt) < 16000


def test_conversation_signals_count_only_user_messages():
    from app.api.v1.endpoints.chipi import _conversation_signals
    from app.schemas.chipi import ChatMessage

    history = [
        ChatMessage(role="user", content="hola"),
        ChatMessage(role="assistant", content="regalar paquete gratis"),
        ChatMessage(role="user", content="mi pago"),
    ]
    text, turns = _conversation_signals("actual", history)
    assert turns == 3
    assert "actual" in text and "mi pago" in text
    assert "regalar" not in text  # lo dicho por el asistente nunca cuenta


# ─── Task 4: cobertura de pantallas ──────────────────────────────────────────

import re

REPO = Path(__file__).resolve().parents[3]
WIDGET = REPO / "frontend" / "components" / "chipi" / "ChipiWidget.tsx"
APP_DIR = REPO / "frontend" / "app"


def _frontend_routes() -> list[tuple[str, str]]:
    pairs = re.findall(r'\["(/[^"]*)",\s*"([^"]+)"\]', WIDGET.read_text(encoding="utf-8"))
    assert len(pairs) > 40, "no se pudo leer SCREEN_ROUTES"
    return sorted(pairs, key=lambda p: -len(p[0]))


def _route_of(page: Path) -> str:
    parts = [p for p in page.relative_to(APP_DIR).parent.parts if not (p.startswith("(") and p.endswith(")"))]
    return "/" + "/".join(parts)


def test_every_frontend_screen_has_a_card():
    wanted = {screen for _, screen in _frontend_routes()} | {"choose_teacher", "teacher_browse"}
    assert wanted <= kb.all_screen_keys(), sorted(wanted - kb.all_screen_keys())


def test_every_page_is_routed_to_a_specific_screen():
    routes = _frontend_routes()
    problems = []
    for page in APP_DIR.rglob("page.tsx"):
        path = _route_of(page)
        if path == "/":
            continue
        if path == "/dashboard/teachers" or path.startswith("/dashboard/teachers/"):
            continue  # caso especial en useScreenName()
        hit = next((key for key, _ in routes if key != "/" and (path == key or path.startswith(key + "/"))), None)
        if hit is None or hit in ("/teacher", "/admin"):
            problems.append(path)
    assert not problems, f"páginas sin pantalla propia en SCREEN_ROUTES: {sorted(problems)}"


def test_all_cards_validate():
    assert kb.validate_cards() == []


# ─── Tasks 6-8: contenido de los temas (preguntas reales -> ficha esperada) ───

STUDENT_QUESTIONS = [
    ("¿cuánto tiempo antes puedo cancelar una clase y recuperar el crédito?", "student__cancelar-reagendar"),
    ("quiero reagendar mi clase", "student__cancelar-reagendar"),
    ("me rechazaron el pago, qué hago", "student__pagos-comprobantes"),
    ("ya pagué por transferencia, ¿qué hago ahora?", "student__pagos-comprobantes"),
    ("el profesor no se conectó a mi clase", "student__estados-de-clase"),
    ("mi clase aparece como finalizada", "student__estados-de-clase"),
    ("¿tengo que hacer una clase de prueba primero?", "student__prueba-gratis"),
    ("quiero renovar mi paquete", "student__renovar-cambiar-paquete"),
    ("quiero cambiar a un paquete más grande", "student__renovar-cambiar-paquete"),
    ("¿puedo pagar en cuotas?", "student__paquetes-creditos"),
    ("¿cuántos créditos me quedan?", "student__paquetes-creditos"),
    ("quiero que me devuelvan el dinero", "student__reembolsos"),
    ("la hora de mi clase cambió por el horario de verano", "student__zonas-horarias-horario-verano"),
    ("¿cómo me uno a una clase grupal?", "student__clases-grupales"),
    ("quiero borrar mi cuenta", "student__borrar-cuenta"),
    ("no me llega el correo de verificación", "student__registro-login-verificacion"),
    ("olvidé mi contraseña", "student__registro-login-verificacion"),
    ("no puedo reservar una clase", "student__reservar-clase"),
    ("¿cómo califico a mi profesor?", "student__resenas"),
    ("¿cómo entrego mi tarea?", "student__chat-tareas-materiales"),
    ("¿qué idiomas puedo poner en mi perfil y qué nivel?", "student__idiomas-nivel"),
    ("¿dónde está el enlace de Google Meet?", "student__google-calendar-meet"),
    ("quiero hablar con una persona de soporte", "student__soporte"),
]


@pytest.mark.parametrize("question,slug", STUDENT_QUESTIONS)
def test_student_topics_answer_core_questions(question, slug):
    picked = [c.slug for c in kb.pick_topics("student", question)]
    assert slug in picked, f"{question!r} -> {picked}"


def test_student_topics_do_not_leak_to_other_roles():
    for card in kb.load_cards("topics").values():
        if card.slug.startswith("student__"):
            assert card.roles == frozenset({"student"})


TEACHER_QUESTIONS = [
    ("¿puedo regalar un paquete gratis a un alumno?", "teacher__paquete-gratis-regalo"),
    ("¿PUEDO REGALAR UN PAQUETE GRATIS?", "teacher__paquete-gratis-regalo"),
    ("quiero darle una beca a un alumno", "teacher__paquete-gratis-regalo"),
    ("¿cómo me aprueban como profesor?", "teacher__alta-aprobacion"),
    ("¿cómo configuro mi disponibilidad?", "teacher__disponibilidad-slots"),
    ("¿cómo creo un paquete y fijo el precio?", "teacher__paquetes-precios"),
    ("no puedo editar el precio de mi paquete", "teacher__paquetes-precios"),
    ("¿cómo creo un grupo con cupo mínimo?", "teacher__cohortes"),
    ("¿cómo marco una clase como completada?", "teacher__clases-del-dia"),
    ("la clase pasó a no_show sola, quiero corregirla", "teacher__clase-finalized-no-show"),
    ("pasaron más de 72 horas y no marqué la clase", "teacher__clase-finalized-no-show"),
    ("¿cómo retiro mi dinero?", "teacher__billetera-retiros"),
    ("¿cuánto es mi comisión?", "teacher__comisiones"),
    ("¿por qué no puedo aprobar un pago de mi alumno?", "teacher__pagos-pendientes-revision"),
    ("un alumno me pide un reembolso", "teacher__reembolsos"),
    ("quiero conectar Google Calendar con Preply", "teacher__google-calendar-preply"),
    ("¿cuánto pesa el material que puedo subir?", "teacher__materiales-tareas"),
    ("quiero cambiar mi video de presentación", "teacher__video-perfil-revision"),
    ("cambió el horario de verano y mi disponibilidad", "teacher__zonas-horarias-horario-verano"),
    ("necesito hablar con soporte", "teacher__soporte"),
]


@pytest.mark.parametrize("role", ["teacher", "teacher_admin"])
@pytest.mark.parametrize("question,slug", TEACHER_QUESTIONS)
def test_teacher_topics_answer_core_questions(role, question, slug):
    picked = [c.slug for c in kb.pick_topics(role, question)]
    assert slug in picked, f"{question!r} -> {picked}"


def test_teacher_topics_are_visible_to_teacher_and_teacher_admin_only():
    for card in kb.load_cards("topics").values():
        if card.slug.startswith("teacher__"):
            assert card.roles == frozenset({"teacher", "teacher_admin"})


def test_teacher_cannot_see_admin_only_topics():
    for card in kb.load_cards("topics").values():
        if card.roles == frozenset({"superadmin"}):
            assert card.slug not in [c.slug for c in kb.pick_topics("teacher", " ".join(card.keywords))]


ADMIN_QUESTIONS = [
    ("¿cómo apruebo un pago pendiente?", "admin__aprobar-pagos-reembolsos"),
    ("¿cómo apruebo una solicitud de paquete gratis de un profesor?", "admin__aprobar-pagos-reembolsos"),
    ("¿cómo proceso un retiro de un profesor?", "admin__retiros"),
    ("quiero cambiar la comisión de un profesor", "admin__comisiones-configuracion"),
    ("hay un video pendiente de un profesor, ¿qué hago?", "admin__aprobar-profesores-video"),
    ("quiero banear a un alumno", "admin__baneos"),
    ("¿cuándo uso el modo dios para corregir créditos?", "admin__modo-dios"),
    ("quiero pasar de single-tenant a multi", "admin__single-multi-transicion"),
    ("resolver una corrección de clase no_show de un profesor", "admin__soporte-tickets-correccion-finalized"),
    ("¿para qué sirve el flow tester?", "admin__flow-tester"),
    ("¿dónde veo los logs de errores?", "admin__logs"),
    ("quiero cambiar el rol de un usuario", "admin__usuarios-roles"),
    ("¿cómo edito los catálogos de idiomas?", "admin__catalogos-reglas"),
    ("¿cuál es el límite diario de correos?", "admin__correos-limite-diario"),
    ("quiero revisar la conversación de un chat", "admin__chats-clases-materiales"),
]


@pytest.mark.parametrize("question,slug", ADMIN_QUESTIONS)
def test_admin_topics_answer_core_questions(question, slug):
    picked = [c.slug for c in kb.pick_topics("superadmin", question)]
    assert slug in picked, f"{question!r} -> {picked}"


def test_admin_topics_never_tell_the_admin_to_open_a_ticket():
    for card in kb.load_cards("topics").values():
        if card.slug.startswith("admin__"):
            for phrase in ("Habla con soporte", "Nuevo ticket", "crear un ticket", "abre un ticket", "abrir un ticket"):
                assert phrase not in card.body, f"{card.slug}: «{phrase}»"


def test_admin_topics_hidden_from_students_and_plain_teachers():
    for card in kb.load_cards("topics").values():
        if card.slug.startswith("admin__"):
            assert not (card.roles & {"student", "teacher", "public"})


# ─── Task 9: fichas de pantalla completas ────────────────────────────────────

SCREEN_HEADERS = ("## Qué es", "## Pasos", "## Reglas", "## Casos límite", "## Cuándo escalar")
SCREENS_WITHOUT_STEPS = {"main", "unauthorized", "privacy", "terms"}


def test_screen_cards_have_steps_and_escalation():
    incomplete = {}
    for slug, card in kb.load_cards("screens").items():
        if slug in SCREENS_WITHOUT_STEPS:
            continue
        missing = [h for h in SCREEN_HEADERS if h not in card.body]
        if missing:
            incomplete[slug] = missing
    assert not incomplete, incomplete


def test_admin_only_screens_are_not_shown_to_other_roles():
    for slug in ("admin_flow_tester", "admin_god_mode"):
        card = kb.load_cards("screens")[slug]
        assert "teacher_admin" not in card.roles or slug == "admin_god_mode"
        assert not (card.roles & {"student", "teacher", "public"})


def test_public_prompt_offers_support_email(fake_knowledge):
    prompt = _prompt(None, screen="login")
    assert "soporte@mail.tuprofemaria.com" in prompt
    assert "Habla con soporte" not in prompt  # el botón solo existe con sesión
