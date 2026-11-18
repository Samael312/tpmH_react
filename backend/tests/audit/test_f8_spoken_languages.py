"""Fases 8 y 10: idiomas que HABLA el usuario (users.spoken_languages) con su NIVEL, separados de los que el profesor ENSEÑA."""
import pytest

from tests.audit.conftest import _mk_user, hdr
from app.core import spoken_languages as sl
from app.core.teacher_students import link_student_to_teacher
from app.models.system_catalog import SystemCatalog
from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.models.user import User

API = "/api/v1"
ME = f"{API}/users/me"


def L(*names, level="fluent"):
    """[{language, level}] para el cuerpo de la peticion."""
    return [{"language": n, "level": level} for n in names]


def names(items):
    return [i["language"] for i in items]


def patch(client, user, body):
    return client.patch(ME, json=body, headers=hdr(user))


def me(client, user):
    return client.get(ME, headers=hdr(user)).json()


def set_catalog(db, values):
    row = db.query(SystemCatalog).filter(SystemCatalog.key == "spoken_languages").first()
    if row:
        row.value = values
    else:
        db.add(SystemCatalog(key="spoken_languages", label="Idiomas que habla", value=values))
    db.commit()


# ─── Normalizacion pura ────────────────────────────────────────────────────────

CAT = ["Español", "Inglés", "Francés"]


def test_normalize_matches_case_and_accents_and_uses_catalog_spelling():
    got = sl.normalize_spoken_languages(
        [{"language": "ingles", "level": "native"}, {"language": " ESPAÑOL ", "level": "basic"}], CAT)
    assert got == [{"language": "Inglés", "level": "native"}, {"language": "Español", "level": "basic"}]


@pytest.mark.parametrize("bad", ["Inglés", None, {"a": 1}, 5])
def test_normalize_rejects_non_lists(bad):
    with pytest.raises(sl.SpokenLanguagesError):
        sl.normalize_spoken_languages(bad, CAT)


@pytest.mark.parametrize("bad", [[1], [None], [["Inglés"]], ["Inglés"]])   # textos sueltos ya no valen: falta el nivel
def test_normalize_rejects_non_object_items(bad):
    with pytest.raises(sl.SpokenLanguagesError):
        sl.normalize_spoken_languages(bad, CAT)


@pytest.mark.parametrize("level", [None, "", "expert", "FLUENT", 3, "Nativo"])
def test_normalize_requires_a_valid_level(level):
    with pytest.raises(sl.SpokenLanguagesError, match="nivel"):
        sl.normalize_spoken_languages([{"language": "Inglés", "level": level}], CAT)


def test_normalize_missing_level_key_rejected():
    with pytest.raises(sl.SpokenLanguagesError):
        sl.normalize_spoken_languages([{"language": "Inglés"}], CAT)


@pytest.mark.parametrize("level", sl.LEVELS)
def test_all_four_levels_accepted(level):
    assert sl.normalize_spoken_languages([{"language": "Inglés", "level": level}], CAT)[0]["level"] == level


def test_empty_list_is_valid():
    assert sl.normalize_spoken_languages([], CAT) == []


def test_read_handles_legacy_strings_new_format_and_garbage():
    raw = ["Inglés", {"language": "Español", "level": "native"}, {"language": "Francés", "level": "raro"}, 7, None, "", {"x": 1}]
    assert sl.read_spoken_languages(raw) == [
        {"language": "Inglés", "level": None},
        {"language": "Español", "level": "native"},
        {"language": "Francés", "level": None},
    ]
    assert sl.read_spoken_languages(None) == [] and sl.read_spoken_languages("x") == []


def test_speaks_ignores_case_and_accents_and_legacy_format():
    assert sl.speaks(["Inglés"], "ingles") and sl.speaks([{"language": "Español", "level": "native"}], "ESPANOL")
    assert not sl.speaks([], "Inglés") and not sl.speaks(["Francés"], "Inglés")


# ─── API: usuarios nuevos, ambos roles, idempotencia ───────────────────────────

def test_new_user_starts_with_empty_list(client, world):
    assert me(client, world["s_user"])["spoken_languages"] == []
    assert me(client, world["t_user"])["spoken_languages"] == []


@pytest.mark.parametrize("who", ["s_user", "t_user"])
def test_both_roles_can_set_and_normalized(client, world, who):
    body = [{"language": "ingles", "level": "native"}, {"language": "FRANCÉS", "level": "basic"}]
    r = patch(client, world[who], {"spoken_languages": body})
    assert r.status_code == 200, r.text
    expected = [{"language": "Inglés", "level": "native"}, {"language": "Francés", "level": "basic"}]
    assert r.json()["spoken_languages"] == expected
    assert me(client, world[who])["spoken_languages"] == expected


def test_each_language_keeps_its_own_level(client, world):
    body = [{"language": "Español", "level": "native"}, {"language": "Inglés", "level": "intermediate"},
            {"language": "Francés", "level": "basic"}]
    got = patch(client, world["s_user"], {"spoken_languages": body}).json()["spoken_languages"]
    assert [(i["language"], i["level"]) for i in got] == [("Español", "native"), ("Inglés", "intermediate"), ("Francés", "basic")]


def test_changing_only_a_level_works(client, world):
    patch(client, world["s_user"], {"spoken_languages": L("Inglés", level="basic")})
    got = patch(client, world["s_user"], {"spoken_languages": L("Inglés", level="fluent")}).json()
    assert got["spoken_languages"] == [{"language": "Inglés", "level": "fluent"}]


def test_saving_twice_is_idempotent(client, world):
    body = {"spoken_languages": L("Español", "Inglés")}
    first = patch(client, world["s_user"], body).json()
    second = patch(client, world["s_user"], body).json()
    assert first["spoken_languages"] == second["spoken_languages"] == L("Español", "Inglés")


def test_missing_or_invalid_level_is_422_and_changes_nothing(client, world):
    patch(client, world["s_user"], {"spoken_languages": L("Español")})
    for bad in ([{"language": "Inglés"}], [{"language": "Inglés", "level": "experto"}], ["Inglés"]):
        r = patch(client, world["s_user"], {"spoken_languages": bad})
        assert r.status_code == 422, bad
    assert me(client, world["s_user"])["spoken_languages"] == L("Español")


def test_does_not_touch_taught_languages(client, db, world):
    before = list(db.get(TeacherProfile, world["tp"].id).languages)
    assert patch(client, world["t_user"], {"spoken_languages": L("Francés")}).status_code == 200
    db.expire_all()
    assert list(db.get(TeacherProfile, world["tp"].id).languages) == before == ["English"]


def test_omitting_field_keeps_value(client, world):
    patch(client, world["s_user"], {"spoken_languages": L("Español")})
    patch(client, world["s_user"], {"name": "Otro"})
    assert me(client, world["s_user"])["spoken_languages"] == L("Español")


def test_empty_list_clears(client, world):
    patch(client, world["s_user"], {"spoken_languages": L("Español")})
    assert patch(client, world["s_user"], {"spoken_languages": []}).json()["spoken_languages"] == []


def test_legacy_strings_from_phase_8_are_read_with_null_level_and_can_be_completed(client, db, world):
    u = db.get(User, world["s_user"].id)
    u.spoken_languages = ["Español", "Inglés"]       # como se guardaba en la Fase 8
    db.commit()
    assert me(client, world["s_user"])["spoken_languages"] == [
        {"language": "Español", "level": None}, {"language": "Inglés", "level": None}]
    r = patch(client, world["s_user"], {"spoken_languages": [
        {"language": "Español", "level": "native"}, {"language": "Inglés", "level": "fluent"}]})
    assert r.status_code == 200
    assert [i["level"] for i in me(client, world["s_user"])["spoken_languages"]] == ["native", "fluent"]


# ─── Limites ───────────────────────────────────────────────────────────────────

def test_max_10_languages(client, db, world):
    set_catalog(db, [f"Idioma{i:02d}" for i in range(12)])
    assert patch(client, world["s_user"], {"spoken_languages": L(*[f"Idioma{i:02d}" for i in range(10)])}).status_code == 200
    assert patch(client, world["s_user"], {"spoken_languages": L(*[f"Idioma{i:02d}" for i in range(11)])}).status_code == 422
    assert len(me(client, world["s_user"])["spoken_languages"]) == 10  # el rechazo no cambia nada


def test_length_boundaries_2_40_41(client, db, world):
    ok2, ok40, bad41, bad1 = "Xh", "A" * 40, "B" * 41, "Z"
    set_catalog(db, [ok2, ok40, bad41, bad1])
    assert patch(client, world["s_user"], {"spoken_languages": L(ok2)}).status_code == 200
    assert patch(client, world["s_user"], {"spoken_languages": L(ok40)}).status_code == 200
    assert patch(client, world["s_user"], {"spoken_languages": L(bad41)}).status_code == 422
    assert patch(client, world["s_user"], {"spoken_languages": L(bad1)}).status_code == 422


# ─── Catalogo y duplicados ─────────────────────────────────────────────────────

@pytest.mark.parametrize("who", ["s_user", "t_user"])
@pytest.mark.parametrize("body,expected", [
    (L("Inglés", "inglés"), 422),        # duplicado con otra capitalizacion
    (L("Inglés", "INGLES"), 422),        # duplicado sin tilde
    (L("Klingon"), 422),                 # ajeno al catalogo
    (L("<script>alert(1)</script>"), 422),
    ("Inglés", 422),                     # no es lista
    ([5], 422),
    (L("Inglés", "Francés"), 200),
])
def test_role_x_catalog_x_duplicates(client, world, who, body, expected):
    assert patch(client, world[who], {"spoken_languages": body}).status_code == expected


def test_catalog_is_editable_and_drives_validation(client, db, world):
    set_catalog(db, ["Español", "Quechua"])
    assert names(patch(client, world["s_user"], {"spoken_languages": L("quechua")}).json()["spoken_languages"]) == ["Quechua"]
    assert patch(client, world["s_user"], {"spoken_languages": L("Inglés")}).status_code == 422  # ya no esta
    r = client.patch(f"{API}/system-catalogs/spoken_languages", json={"value": ["Español", "Guaraní"]}, headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text
    assert patch(client, world["s_user"], {"spoken_languages": L("Guaraní")}).status_code == 200


def test_catalog_is_public_and_separate_from_taught_languages(client, db, world):
    set_catalog(db, ["Español"])
    db.add(SystemCatalog(key="languages", label="Idiomas", value=["Ingles", "Frances"]))
    db.commit()
    cats = client.get(f"{API}/system-catalogs/").json()
    assert cats["spoken_languages"] == ["Español"] and cats["languages"] == ["Ingles", "Frances"]


# ─── Onboarding: minimo 1 ──────────────────────────────────────────────────────

def fresh_user(db, role="student", name="nuevo", with_avatar=True):
    u = _mk_user(db, role, name)
    u.onboarding_completed = False
    if with_avatar:
        u.avatar = "https://res.cloudinary.com/x/avatar.png"
    db.commit()
    return u


@pytest.mark.parametrize("role", ["student", "teacher"])
def test_onboarding_needs_at_least_one_language(client, db, world, role):
    u = fresh_user(db, role, f"nuevo_{role}")
    r = patch(client, u, {"onboarding_completed": True})                       # 0 idiomas
    assert r.status_code == 422 and "idioma" in r.json()["detail"].lower()
    r = patch(client, u, {"onboarding_completed": True, "spoken_languages": []})  # 0 explicito
    assert r.status_code == 422
    assert me(client, u)["onboarding_completed"] is False
    r = patch(client, u, {"onboarding_completed": True, "spoken_languages": L("Español", level="native")})  # 1
    assert r.status_code == 200 and r.json()["onboarding_completed"] is True


def test_student_onboarding_needs_a_profile_photo(client, db, world):
    u = fresh_user(db, "student", "sin_foto", with_avatar=False)
    r = patch(client, u, {"onboarding_completed": True, "spoken_languages": L("Español", level="native")})
    assert r.status_code == 422 and "foto" in r.json()["detail"].lower()
    assert me(client, u)["onboarding_completed"] is False
    # con foto (subida antes o enviada en la misma peticion) termina bien
    r = patch(client, u, {"onboarding_completed": True, "spoken_languages": L("Español", level="native"),
                          "avatar": "https://res.cloudinary.com/x/a.png"})
    assert r.status_code == 200 and r.json()["onboarding_completed"] is True


def test_onboarding_rejects_a_language_without_level(client, db, world):
    u = fresh_user(db)
    r = patch(client, u, {"onboarding_completed": True, "spoken_languages": [{"language": "Español"}]})
    assert r.status_code == 422 and "nivel" in r.json()["detail"].lower()
    assert me(client, u)["onboarding_completed"] is False


def test_onboarding_accepts_languages_saved_in_an_earlier_step(client, db, world):
    u = fresh_user(db)
    assert patch(client, u, {"spoken_languages": L("Inglés")}).status_code == 200
    assert patch(client, u, {"onboarding_completed": True}).status_code == 200


def test_already_onboarded_users_are_not_blocked(client, world):
    # alumno con onboarding ya terminado y sin idiomas: puede seguir editando todo sin error
    assert me(client, world["s_user"])["onboarding_completed"] is True
    assert patch(client, world["s_user"], {"name": "Cambio"}).status_code == 200
    assert patch(client, world["s_user"], {"onboarding_completed": True}).status_code == 200


# ─── Quien ve que ──────────────────────────────────────────────────────────────

def test_public_teacher_profile_and_list_expose_spoken_languages_with_level(client, world):
    body = [{"language": "Español", "level": "native"}, {"language": "Inglés", "level": "intermediate"}]
    patch(client, world["t_user"], {"spoken_languages": body})
    one = client.get(f"{API}/teachers/{world['t_user'].username}").json()
    assert one["spoken_languages"] == body and one["languages"] == ["English"]
    assert client.get(f"{API}/teachers/").json()[0]["spoken_languages"] == body


def test_student_languages_visible_only_to_their_teacher(client, db, world):
    patch(client, world["s_user"], {"spoken_languages": L("Francés", level="basic")})
    link_student_to_teacher(db, world["sp"], world["tp"])
    db.commit()
    mine = client.get(f"{API}/teachers/me/students-full", headers=hdr(world["t_user"])).json()
    assert [s["spoken_languages"] for s in mine] == [L("Francés", level="basic")]

    # otro profesor sin vinculo no ve al alumno
    other_u = _mk_user(db, "teacher", "otroprofe")
    db.add(TeacherProfile(user_id=other_u.id, user_username=other_u.username, timezone="UTC",
                          languages=["English"], subjects=["English"]))
    db.commit()
    assert client.get(f"{API}/teachers/me/students-full", headers=hdr(other_u)).json() == []

    # ningun endpoint publico devuelve idiomas de un alumno
    assert client.get(f"{API}/teachers/{world['s_user'].username}").status_code == 404
    assert "Francés" not in client.get(f"{API}/public/landing").text


def test_another_student_cannot_read_my_languages(client, db, world):
    patch(client, world["s_user"], {"spoken_languages": L("Francés")})
    other = _mk_user(db, "student", "otroalumno")
    db.add(StudentProfile(user_id=other.id, user_username=other.username, timezone="UTC"))
    db.commit()
    assert me(client, other)["spoken_languages"] == []
    assert client.get(f"{API}/teachers/me/students-full", headers=hdr(other)).status_code == 403


def test_integration_onboarding_to_profile_to_public_api(client, db, world):
    """Onboarding (profesor nuevo) -> perfil -> API publica."""
    u = fresh_user(db, "teacher", "profe_nuevo")
    db.add(TeacherProfile(user_id=u.id, user_username=u.username, timezone="UTC", status=world["tp"].status,
                          languages=["English"], subjects=["English"], video_url="http://v"))
    db.commit()
    body = [{"language": "Español", "level": "native"}, {"language": "Portugués", "level": "basic"}]
    assert patch(client, u, {"spoken_languages": body, "onboarding_completed": True}).status_code == 200
    assert me(client, u)["spoken_languages"] == body
    assert client.get(f"{API}/teachers/{u.username}").json()["spoken_languages"] == body
    patch(client, u, {"spoken_languages": L("Español", level="native")})  # edicion desde el perfil
    assert names(client.get(f"{API}/teachers/{u.username}").json()["spoken_languages"]) == ["Español"]


# ─── Filtro del directorio (Fase 10) ───────────────────────────────────────────

def _second_teacher(db, world, username, spoken):
    u = _mk_user(db, "teacher", username)
    u.spoken_languages = spoken
    db.add(TeacherProfile(user_id=u.id, user_username=u.username, status=world["tp"].status, timezone="UTC",
                          languages=["English"], subjects=["English"], video_url="http://v"))
    db.commit()
    return u


def test_directory_filter_by_spoken_language(client, db, world):
    patch(client, world["t_user"], {"spoken_languages": L("Español", "Inglés")})
    _second_teacher(db, world, "profe_fr", [{"language": "Francés", "level": "native"}])
    _second_teacher(db, world, "profe_none", [])

    def users(q):
        r = client.get(f"{API}/teachers/{q}")
        assert r.status_code == 200
        return sorted(t["user_username"] for t in r.json())

    assert len(users("")) == 3
    assert users("?speaks=Español") == [world["t_user"].username]
    assert users("?speaks=frances") == ["profe_fr"]          # sin tildes ni mayusculas
    assert users("?speaks=Klingon") == []
    assert len(users("?speaks=")) == 3                        # vacio = sin filtro


def test_directory_filter_includes_legacy_string_data_and_combines_with_other_filters(client, db, world):
    _second_teacher(db, world, "profe_legacy", ["Italiano"])   # Fase 8: texto suelto
    patch(client, world["t_user"], {"spoken_languages": L("Italiano")})
    both = client.get(f"{API}/teachers/?speaks=italiano").json()
    assert len(both) == 2
    assert [t["user_username"] for t in client.get(f"{API}/teachers/?speaks=italiano&language=German").json()] == []
    assert len(client.get(f"{API}/teachers/?speaks=italiano&language=english").json()) == 2


def test_directory_filter_rejects_overlong_value(client, world):
    assert client.get(f"{API}/teachers/?speaks={'x' * 41}").status_code == 422
