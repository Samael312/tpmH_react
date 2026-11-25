"""TTS por idioma del vocabulario.

Antes: se mandaba a OpenAI (`tts-1`) solo la palabra suelta; sin idioma, el modelo la adivinaba y una palabra aislada
en español («pera», «uva») sonaba con fonética inglesa. Ahora el vocabulario guarda su idioma (`Material.language`) y
se pasa en la instrucción de una sesión Realtime (`gpt-realtime-2.1-mini`, una por palabra, solo audio, WAV), con
como mucho `TTS_MAX_CONCURRENCY` sesiones a la vez. Sin red: OpenAI y Cloudinary se sustituyen.
"""
import asyncio
import base64
import hashlib
import io
import types
import wave

import pytest

from app.core import tts_service
from app.models.material import Material
from tests.audit.conftest import hdr
from tests.audit.helpers import API


class _FakeConn:
    """Sesión Realtime simulada: registra la configuración y la palabra, y emite los eventos de una respuesta."""

    def __init__(self, outer):
        self.outer = outer
        self.session = self
        self.conversation = types.SimpleNamespace(item=self)
        self.response = self
        self.word = None

    async def __aenter__(self):
        o = self.outer
        o.active += 1
        o.max_active = max(o.max_active, o.active)
        return self

    async def __aexit__(self, *exc):
        self.outer.active -= 1

    # conn.session.update / conn.conversation.item.create / conn.response.create
    async def update(self, session):
        self.outer.sessions.append(session)

    async def create(self, item=None):
        if item is not None:
            self.word = item["content"][0]["text"]
            self.outer.words.append(self.word)
            return
        await asyncio.sleep(self.outer.delay)  # generar el audio tarda un poco

    def __aiter__(self):
        return self._events()

    async def _events(self):
        o = self.outer
        if self.word in o.fail_words:
            raise RuntimeError("sesión rota")
        yield types.SimpleNamespace(type="session.updated")
        if self.word in o.silent_words:
            yield types.SimpleNamespace(type="response.done", response=types.SimpleNamespace(status="completed"))
            return
        yield types.SimpleNamespace(type="response.output_audio.delta", delta=base64.b64encode(o.pcm).decode())
        yield types.SimpleNamespace(type="response.done", response=types.SimpleNamespace(status="completed"))


class _FakeOpenAI:
    """Sustituye al cliente de OpenAI: `client.realtime.connect(model=...)`."""

    def __init__(self):
        self.sessions, self.words, self.models = [], [], []
        self.fail_words, self.silent_words = set(), set()
        self.active = self.max_active = 0
        self.delay = 0.0
        self.pcm = b"\x01\x00" * 2400  # 0,1 s a 24 kHz
        outer = self

        class Realtime:
            def connect(self, model):
                outer.models.append(model)
                return _FakeConn(outer)

        self.realtime = Realtime()


@pytest.fixture
def fake_openai(monkeypatch):
    fake = _FakeOpenAI()
    uploads = []

    def fake_upload(**kw):
        uploads.append(kw)
        return {"url": "http://audio/" + kw["filename"]}

    fake.uploads = uploads
    monkeypatch.setattr(tts_service, "client", fake)
    monkeypatch.setattr(tts_service, "upload_file", fake_upload)
    monkeypatch.setattr(tts_service, "TTS_WORD_ATTEMPTS", 1)  # los reintentos se prueban aparte
    tts_service._audio_cache.clear()
    yield fake
    tts_service._audio_cache.clear()


# ── servicio ────────────────────────────────────────────────────────────────────────────────

def test_without_language_the_word_is_said_in_its_own_language(fake_openai):
    asyncio.run(tts_service.generate_word_audio("hola"))
    session = fake_openai.sessions[0]
    assert fake_openai.words == ["hola"] and fake_openai.models == [tts_service.REALTIME_MODEL]
    assert session["output_modalities"] == ["audio"]  # solo audio
    assert "in the language the word belongs to" in session["instructions"]


def test_language_names_the_language_in_the_session_instructions(fake_openai):
    asyncio.run(tts_service.generate_word_audio("pera", language="Español"))
    session = fake_openai.sessions[0]
    assert fake_openai.words == ["pera"]
    assert "Spanish" in session["instructions"]  # el catálogo está en español; la instrucción, en inglés
    assert "Say ONLY that word" in session["instructions"]


def test_the_audio_is_uploaded_as_a_valid_wav(fake_openai):
    url = asyncio.run(tts_service.generate_word_audio("pera", language="Español"))
    up = fake_openai.uploads[0]
    assert up["content_type"] == "audio/wav" and up["filename"].endswith(".wav") and up["folder"] == "tts_cache"
    assert url == "http://audio/" + up["filename"]
    with wave.open(io.BytesIO(up["file_bytes"]), "rb") as w:  # cabecera correcta y los datos intactos
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (1, 2, 24000)
        assert w.readframes(w.getnframes()) == fake_openai.pcm


def test_the_wav_passes_the_storage_checks_but_is_not_a_user_upload_type():
    from app.core import storage
    wav = tts_service.pcm_to_wav(b"\x00\x00" * 100)
    assert storage._matches_declared_type(wav[:16], "audio/wav") is True
    assert storage._matches_declared_type(b"ID3\x03" + b"\x00" * 12, "audio/wav") is False
    assert "audio/wav" not in storage.ALL_ALLOWED_TYPES  # un profesor no puede subir un .wav como material
    with pytest.raises(ValueError):
        storage.upload_file_stream(io.BytesIO(wav), "x.wav", "audio/wav")


@pytest.mark.parametrize("our_voice,realtime", [
    ("nova", "marin"), ("onyx", "cedar"), ("fable", "verse"), ("alloy", "alloy"), ("echo", "echo"), ("shimmer", "shimmer"),
])
def test_our_voices_map_to_realtime_voices(fake_openai, our_voice, realtime):
    asyncio.run(tts_service.generate_word_audio("uno", voice=our_voice))
    assert fake_openai.sessions[0]["audio"]["output"]["voice"] == realtime


@pytest.mark.parametrize("catalog_name,english", [
    ("Español", "Spanish"), ("inglés", "English"), ("Francés", "French"), ("Portugués", "Portuguese"),
    ("Alemán", "German"), ("Japonés", "Japanese"), ("Neerlandés", "Dutch"),
])
def test_catalog_names_map_to_english_language_names(catalog_name, english):
    assert tts_service.english_language_name(catalog_name) == english


def test_unknown_catalog_language_is_passed_as_is(fake_openai):
    asyncio.run(tts_service.generate_word_audio("moltbé", language="Catalán"))
    assert "Catalán" in fake_openai.sessions[0]["instructions"]


def test_blank_language_is_the_same_as_none(fake_openai):
    asyncio.run(tts_service.generate_word_audio("hola", language="  "))
    assert "in the language the word belongs to" in fake_openai.sessions[0]["instructions"]


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
    assert len(fake_openai.words) == 2


def test_batch_and_count_cached_use_the_language(fake_openai):
    asyncio.run(tts_service.generate_word_audio("uva", language="Español"))
    assert tts_service.count_cached(["uva", "pera"], language="Español") == 1
    assert tts_service.count_cached(["uva", "pera"]) == 0  # sin idioma es otra clave
    urls = asyncio.run(tts_service.generate_batch_audio(["uva", "pera"], language="Español"))
    assert set(urls) == {"uva", "pera"} and all(urls.values())
    assert fake_openai.words == ["uva", "pera"]  # uva (antes) + pera (ahora)
    assert all("Spanish" in s["instructions"] for s in fake_openai.sessions)


# ── concurrencia, errores y reintentos ────────────────────────────────────────────────────────

def test_a_batch_runs_in_a_queue_of_five_at_a_time(fake_openai, monkeypatch):
    monkeypatch.setattr(tts_service, "TTS_MAX_CONCURRENCY", 5)
    fake_openai.delay = 0.05
    words = [f"palabra{i}" for i in range(20)]
    urls = asyncio.run(tts_service.generate_batch_audio(words, language="Español"))
    assert len(urls) == 20 and all(urls.values())
    assert len(fake_openai.words) == 20
    assert fake_openai.max_active == 5  # nunca más de 5 sesiones a la vez, y se llegó a usar el cupo entero


def test_the_concurrency_limit_is_adjustable(fake_openai, monkeypatch):
    monkeypatch.setattr(tts_service, "TTS_MAX_CONCURRENCY", 2)
    fake_openai.delay = 0.03
    asyncio.run(tts_service.generate_batch_audio([f"w{i}" for i in range(7)]))
    assert fake_openai.max_active == 2


def test_the_limit_is_shared_by_concurrent_requests(fake_openai, monkeypatch):
    """Dos lotes a la vez comparten el mismo tope (es del servidor, no de la petición)."""
    monkeypatch.setattr(tts_service, "TTS_MAX_CONCURRENCY", 3)
    fake_openai.delay = 0.03

    async def two_batches():
        await asyncio.gather(
            tts_service.generate_batch_audio([f"a{i}" for i in range(6)]),
            tts_service.generate_batch_audio([f"b{i}" for i in range(6)]),
        )

    asyncio.run(two_batches())
    assert len(fake_openai.words) == 12 and fake_openai.max_active == 3


def test_one_failing_word_does_not_sink_the_batch(fake_openai):
    fake_openai.fail_words = {"mala"}
    urls = asyncio.run(tts_service.generate_batch_audio(["buena", "mala", "otra"]))
    assert urls["mala"] is None and urls["buena"] and urls["otra"]


def test_a_session_that_returns_no_audio_is_an_error(fake_openai):
    fake_openai.silent_words = {"muda"}
    with pytest.raises(ValueError):
        asyncio.run(tts_service.generate_word_audio("muda"))
    assert fake_openai.uploads == []  # no se sube nada


def test_a_failed_word_is_retried_once(fake_openai, monkeypatch):
    monkeypatch.setattr(tts_service, "TTS_WORD_ATTEMPTS", 2)
    state = {"n": 0}
    real = tts_service._synthesize_pcm

    async def flaky(word, voice, language):
        state["n"] += 1
        if state["n"] == 1:
            raise RuntimeError("corte de red")
        return await real(word, voice, language)

    monkeypatch.setattr(tts_service, "_synthesize_pcm", flaky)
    assert asyncio.run(tts_service.generate_word_audio("hola"))
    assert state["n"] == 2


def test_a_word_that_takes_too_long_times_out(fake_openai, monkeypatch):
    monkeypatch.setattr(tts_service, "TTS_WORD_TIMEOUT_SECONDS", 0.05)
    fake_openai.delay = 1.0
    with pytest.raises(ValueError):
        asyncio.run(tts_service.generate_word_audio("lenta"))


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
