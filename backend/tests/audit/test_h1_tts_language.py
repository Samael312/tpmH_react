"""TTS por idioma del vocabulario.

Antes: se mandaba a OpenAI (`tts-1`, voz nova) solo la palabra suelta; sin idioma, el modelo la adivinaba y una
palabra aislada en español («pera», «uva») sonaba con fonética inglesa. Ahora el vocabulario guarda su idioma
(`Material.language`) y, si lo tiene, se usa un modelo con `instructions`. Sin idioma (materiales antiguos) todo
sigue igual que antes. Sin red: OpenAI y Cloudinary se sustituyen.
"""
import asyncio
import hashlib

import pytest

from app.core import tts_service
from app.models.material import Material
from tests.audit.conftest import hdr
from tests.audit.helpers import API


class _Resp:
    content = b"ID3" + b"\x00" * 20


class _FakeOpenAI:
    """Registra los argumentos de cada audio.speech.create(...)."""

    def __init__(self):
        self.calls = []
        outer = self

        class Speech:
            async def create(self, **kw):
                outer.calls.append(kw)
                return _Resp()

        class Audio:
            speech = Speech()

        self.audio = Audio()


@pytest.fixture
def fake_openai(monkeypatch):
    fake = _FakeOpenAI()
    monkeypatch.setattr(tts_service, "client", fake)
    monkeypatch.setattr(tts_service, "upload_file", lambda **kw: {"url": "http://audio/" + kw["filename"]})
    tts_service._audio_cache.clear()
    yield fake
    tts_service._audio_cache.clear()


# ── servicio ────────────────────────────────────────────────────────────────────────────────

def test_without_language_keeps_the_previous_behaviour(fake_openai):
    asyncio.run(tts_service.generate_word_audio("hola"))
    kw = fake_openai.calls[0]
    assert kw["model"] == "tts-1" and "instructions" not in kw and kw["input"] == "hola"


def test_language_uses_the_instructions_model_and_names_the_language(fake_openai):
    asyncio.run(tts_service.generate_word_audio("pera", language="Español"))
    kw = fake_openai.calls[0]
    assert kw["model"] == tts_service.LANGUAGE_MODEL != "tts-1"
    assert kw["input"] == "pera" and kw["speed"] == tts_service.DEFAULT_SPEED
    assert "Spanish" in kw["instructions"]  # el catálogo está en español; la instrucción, en inglés


@pytest.mark.parametrize("catalog_name,english", [
    ("Español", "Spanish"), ("inglés", "English"), ("Francés", "French"), ("Portugués", "Portuguese"),
    ("Alemán", "German"), ("Japonés", "Japanese"), ("Neerlandés", "Dutch"),
])
def test_catalog_names_map_to_english_language_names(catalog_name, english):
    assert tts_service.english_language_name(catalog_name) == english


def test_unknown_catalog_language_is_passed_as_is(fake_openai):
    asyncio.run(tts_service.generate_word_audio("moltbé", language="Catalán"))
    assert "Catalán" in fake_openai.calls[0]["instructions"]


def test_blank_language_is_the_same_as_none(fake_openai):
    asyncio.run(tts_service.generate_word_audio("hola", language="  "))
    assert fake_openai.calls[0]["model"] == "tts-1"


def test_cache_key_is_unchanged_without_language_and_separates_languages():
    legacy = hashlib.md5("uno_nova_0.9".encode()).hexdigest()
    assert tts_service._get_cache_key("uno", "nova", 0.9) == legacy
    es = tts_service._get_cache_key("uno", "nova", 0.9, "Español")
    fr = tts_service._get_cache_key("uno", "nova", 0.9, "Francés")
    assert len({legacy, es, fr}) == 3
    # sin distinguir mayúsculas ni tildes, igual que el catálogo de idiomas
    assert es == tts_service._get_cache_key("uno", "nova", 0.9, "espanol")


def test_same_word_in_two_languages_is_generated_twice(fake_openai):
    asyncio.run(tts_service.generate_word_audio("pie", language="Español"))
    asyncio.run(tts_service.generate_word_audio("pie", language="Francés"))
    asyncio.run(tts_service.generate_word_audio("pie", language="Español"))  # esta sí viene de la caché
    assert len(fake_openai.calls) == 2


def test_batch_and_count_cached_use_the_language(fake_openai):
    asyncio.run(tts_service.generate_word_audio("uva", language="Español"))
    assert tts_service.count_cached(["uva", "pera"], language="Español") == 1
    assert tts_service.count_cached(["uva", "pera"]) == 0  # sin idioma es otra clave
    urls = asyncio.run(tts_service.generate_batch_audio(["uva", "pera"], language="Español"))
    assert set(urls) == {"uva", "pera"} and all(urls.values())
    assert len(fake_openai.calls) == 2  # uva (antes) + pera (ahora)
    assert all("instructions" in c for c in fake_openai.calls)


# ── endpoints de audio ──────────────────────────────────────────────────────────────────────

def test_word_and_batch_endpoints_pass_the_language(client, world, monkeypatch):
    seen = {}

    async def fake_word(word, voice, speed, language=None):
        seen["word"] = language
        return "http://audio/" + word

    async def fake_batch(words, voice, speed, language=None):
        seen["batch"] = language
        return {w: "http://audio/" + w for w in words}

    monkeypatch.setattr("app.api.v1.endpoints.tts.generate_word_audio", fake_word)
    monkeypatch.setattr("app.api.v1.endpoints.tts.generate_batch_audio", fake_batch)
    h = hdr(world["s_user"])
    assert client.post(f"{API}/tts/word", json={"word": "pera", "language": "Español"}, headers=h).status_code == 200
    assert client.post(f"{API}/tts/batch", json={"words": ["pera"], "language": "Francés"}, headers=h).status_code == 200
    assert seen == {"word": "Español", "batch": "Francés"}
    assert client.post(f"{API}/tts/word", json={"word": "pera", "language": "x" * 41}, headers=h).status_code == 422
    assert client.post(f"{API}/tts/word", json={"word": "pera"}, headers=h).status_code == 200  # sigue siendo opcional
    assert seen["word"] is None


def _vocab(db, world, language=None):
    m = Material(teacher_id=world["tp"].id, title="V", category="vocabulary", vocabulary_words=["Pera", "Uva"],
                 language=language, is_active=True)
    db.add(m)
    db.commit()
    return m


def test_vocabulary_audio_uses_the_language_of_the_material(client, world, db, monkeypatch):
    seen = []

    async def fake_batch(words, voice, speed, language=None):
        seen.append(language)
        return {w: "http://audio/" + w for w in words}

    monkeypatch.setattr("app.api.v1.endpoints.tts.generate_batch_audio", fake_batch)
    h = hdr(world["t_user"])
    assert client.post(f"{API}/tts/vocabulary/{_vocab(db, world, 'Español').id}", headers=h).status_code == 200
    assert client.post(f"{API}/tts/vocabulary/{_vocab(db, world).id}", headers=h).status_code == 200
    assert seen == ["Español", None]


# ── material: guardar y devolver el idioma ───────────────────────────────────────────────────

def test_set_vocabulary_saves_validates_and_returns_the_language(client, world, db):
    h = hdr(world["t_user"])
    m = _vocab(db, world)
    url = f"{API}/materials/{m.id}/vocabulary"
    r = client.post(url, json={"words": ["pera", "uva"], "language": "español"}, headers=h)
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Material, m.id).language == "Español"  # se guarda con la ortografía del catálogo
    # sin el campo se conserva
    assert client.post(url, json={"words": ["pera"]}, headers=h).status_code == 200
    db.expire_all()
    assert db.get(Material, m.id).language == "Español"
    # fuera del catálogo: 422
    assert client.post(url, json={"words": ["pera"], "language": "Klingon"}, headers=h).status_code == 422
    # cadena vacía: se quita (vuelve al comportamiento anterior)
    assert client.post(url, json={"words": ["pera"], "language": ""}, headers=h).status_code == 200
    db.expire_all()
    assert db.get(Material, m.id).language is None


def test_material_responses_include_the_language(client, world, db):
    from app.models.material import MaterialAssignment
    m = _vocab(db, world, "Español")
    db.add(MaterialAssignment(material_id=m.id, student_id=world["sp"].id))
    db.commit()
    mine = client.get(f"{API}/materials/my-materials", headers=hdr(world["t_user"])).json()
    assert [x["language"] for x in mine if x["id"] == m.id] == ["Español"]
    student = client.get(f"{API}/materials/student/my-materials", headers=hdr(world["s_user"])).json()
    assert student[0]["material"]["language"] == "Español"
