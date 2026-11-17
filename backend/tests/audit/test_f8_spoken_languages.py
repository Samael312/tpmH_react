"""Fase 8: idiomas que HABLA el usuario (users.spoken_languages), separados de los que el profesor ENSEÑA."""
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
    assert sl.normalize_spoken_languages(["ingles", " ESPAÑOL "], CAT) == ["Inglés", "Español"]


@pytest.mark.parametrize("bad", ["Inglés", None, {"a": 1}, 5])
def test_normalize_rejects_non_lists(bad):
    with pytest.raises(sl.SpokenLanguagesError):
        sl.normalize_spoken_languages(bad, CAT)


@pytest.mark.parametrize("bad", [[1], [None], [["Inglés"]]])
def test_normalize_rejects_non_string_items(bad):
    with pytest.raises(sl.SpokenLanguagesError):
        sl.normalize_spoken_languages(bad, CAT)


def test_empty_list_is_valid():
    assert sl.normalize_spoken_languages([], CAT) == []


# ─── API: usuarios nuevos, ambos roles, idempotencia ───────────────────────────

def test_new_user_starts_with_empty_list(client, world):
    assert me(client, world["s_user"])["spoken_languages"] == []
    assert me(client, world["t_user"])["spoken_languages"] == []


@pytest.mark.parametrize("who", ["s_user", "t_user"])
def test_both_roles_can_set_and_normalized(client, world, who):
    r = patch(client, world[who], {"spoken_languages": ["ingles", "FRANCÉS"]})
    assert r.status_code == 200, r.text
    assert r.json()["spoken_languages"] == ["Inglés", "Francés"]
    assert me(client, world[who])["spoken_languages"] == ["Inglés", "Francés"]


def test_saving_twice_is_idempotent(client, world):
    body = {"spoken_languages": ["Español", "Inglés"]}
    first = patch(client, world["s_user"], body).json()
    second = patch(client, world["s_user"], body).json()
    assert first["spoken_languages"] == second["spoken_languages"] == ["Español", "Inglés"]


def test_does_not_touch_taught_languages(client, db, world):
    before = list(db.get(TeacherProfile, world["tp"].id).languages)
    assert patch(client, world["t_user"], {"spoken_languages": ["Francés"]}).status_code == 200
    db.expire_all()
    assert list(db.get(TeacherProfile, world["tp"].id).languages) == before == ["English"]


def test_omitting_field_keeps_value(client, world):
    patch(client, world["s_user"], {"spoken_languages": ["Español"]})
    patch(client, world["s_user"], {"name": "Otro"})
    assert me(client, world["s_user"])["spoken_languages"] == ["Español"]


def test_empty_list_clears(client, world):
    patch(client, world["s_user"], {"spoken_languages": ["Español"]})
    assert patch(client, world["s_user"], {"spoken_languages": []}).json()["spoken_languages"] == []


# ─── Limites ───────────────────────────────────────────────────────────────────

def test_max_10_languages(client, db, world):
    set_catalog(db, [f"Idioma{i:02d}" for i in range(12)])
    ten = [f"Idioma{i:02d}" for i in range(10)]
    assert patch(client, world["s_user"], {"spoken_languages": ten}).status_code == 200
    eleven = [f"Idioma{i:02d}" for i in range(11)]
    assert patch(client, world["s_user"], {"spoken_languages": eleven}).status_code == 422
    assert len(me(client, world["s_user"])["spoken_languages"]) == 10  # el rechazo no cambia nada


def test_length_boundaries_2_40_41(client, db, world):
    ok2, ok40, bad41, bad1 = "Xh", "A" * 40, "B" * 41, "Z"
    set_catalog(db, [ok2, ok40, bad41, bad1])
    assert patch(client, world["s_user"], {"spoken_languages": [ok2]}).status_code == 200
    assert patch(client, world["s_user"], {"spoken_languages": [ok40]}).status_code == 200
    assert patch(client, world["s_user"], {"spoken_languages": [bad41]}).status_code == 422
    assert patch(client, world["s_user"], {"spoken_languages": [bad1]}).status_code == 422


# ─── Catalogo y duplicados ─────────────────────────────────────────────────────

@pytest.mark.parametrize("who", ["s_user", "t_user"])
@pytest.mark.parametrize("body,expected", [
    (["Inglés", "inglés"], 422),        # duplicado con otra capitalizacion
    (["Inglés", "INGLES"], 422),        # duplicado sin tilde
    (["Klingon"], 422),                 # ajeno al catalogo
    (["<script>alert(1)</script>"], 422),
    ("Inglés", 422),                    # no es lista
    ([5], 422),
    (["Inglés", "Francés"], 200),
])
def test_role_x_catalog_x_duplicates(client, world, who, body, expected):
    assert patch(client, world[who], {"spoken_languages": body}).status_code == expected


def test_catalog_is_editable_and_drives_validation(client, db, world):
    set_catalog(db, ["Español", "Quechua"])
    assert patch(client, world["s_user"], {"spoken_languages": ["quechua"]}).json()["spoken_languages"] == ["Quechua"]
    assert patch(client, world["s_user"], {"spoken_languages": ["Inglés"]}).status_code == 422  # ya no esta
    r = client.patch(f"{API}/system-catalogs/spoken_languages", json={"value": ["Español", "Guaraní"]}, headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text
    assert patch(client, world["s_user"], {"spoken_languages": ["Guaraní"]}).status_code == 200


def test_catalog_is_public_and_separate_from_taught_languages(client, db, world):
    set_catalog(db, ["Español"])
    db.add(SystemCatalog(key="languages", label="Idiomas", value=["Ingles", "Frances"]))
    db.commit()
    cats = client.get(f"{API}/system-catalogs/").json()
    assert cats["spoken_languages"] == ["Español"] and cats["languages"] == ["Ingles", "Frances"]


# ─── Onboarding: minimo 1 ──────────────────────────────────────────────────────

def fresh_user(db, role="student", name="nuevo"):
    u = _mk_user(db, role, name)
    u.onboarding_completed = False
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
    r = patch(client, u, {"onboarding_completed": True, "spoken_languages": ["Español"]})  # 1
    assert r.status_code == 200 and r.json()["onboarding_completed"] is True


def test_onboarding_accepts_languages_saved_in_an_earlier_step(client, db, world):
    u = fresh_user(db)
    assert patch(client, u, {"spoken_languages": ["Inglés"]}).status_code == 200
    assert patch(client, u, {"onboarding_completed": True}).status_code == 200


def test_already_onboarded_users_are_not_blocked(client, world):
    # alumno con onboarding ya terminado y sin idiomas: puede seguir editando todo sin error
    assert me(client, world["s_user"])["onboarding_completed"] is True
    assert patch(client, world["s_user"], {"name": "Cambio"}).status_code == 200
    assert patch(client, world["s_user"], {"onboarding_completed": True}).status_code == 200


# ─── Quien ve que ──────────────────────────────────────────────────────────────

def test_public_teacher_profile_and_list_expose_spoken_languages(client, world):
    patch(client, world["t_user"], {"spoken_languages": ["Español", "Inglés"]})
    one = client.get(f"{API}/teachers/{world['t_user'].username}").json()
    assert one["spoken_languages"] == ["Español", "Inglés"] and one["languages"] == ["English"]
    listed = client.get(f"{API}/teachers/").json()
    assert listed[0]["spoken_languages"] == ["Español", "Inglés"]


def test_student_languages_visible_only_to_their_teacher(client, db, world):
    patch(client, world["s_user"], {"spoken_languages": ["Francés"]})
    link_student_to_teacher(db, world["sp"], world["tp"])
    db.commit()
    mine = client.get(f"{API}/teachers/me/students-full", headers=hdr(world["t_user"])).json()
    assert [s["spoken_languages"] for s in mine] == [["Francés"]]

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
    patch(client, world["s_user"], {"spoken_languages": ["Francés"]})
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
    assert patch(client, u, {"spoken_languages": ["Español", "Portugués"], "onboarding_completed": True}).status_code == 200
    assert me(client, u)["spoken_languages"] == ["Español", "Portugués"]
    pub = client.get(f"{API}/teachers/{u.username}").json()
    assert pub["spoken_languages"] == ["Español", "Portugués"]
    patch(client, u, {"spoken_languages": ["Español"]})  # edicion desde el perfil
    assert client.get(f"{API}/teachers/{u.username}").json()["spoken_languages"] == ["Español"]
