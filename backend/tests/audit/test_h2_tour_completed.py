"""Guía interactiva: `users.tour_completed` (nace en False; la migración deja en True a los usuarios existentes)."""
import importlib.util
import pathlib

import sqlalchemy as sa

from tests.audit.conftest import hdr
from tests.audit.helpers import API


def _me(client, user):
    r = client.get(f"{API}/users/me", headers=hdr(user))
    assert r.status_code == 200, r.text
    return r.json()


def test_new_user_starts_with_tour_not_completed(client, world):
    assert _me(client, world["s_user"])["tour_completed"] is False


def test_patch_sets_and_clears_tour_completed(client, world):
    h = hdr(world["s_user"])
    r = client.patch(f"{API}/users/me", json={"tour_completed": True}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["tour_completed"] is True
    assert _me(client, world["s_user"])["tour_completed"] is True
    assert client.patch(f"{API}/users/me", json={"tour_completed": False}, headers=h).status_code == 200
    assert _me(client, world["s_user"])["tour_completed"] is False


def test_patch_tour_completed_does_not_touch_onboarding(client, world):
    before = _me(client, world["s_user"])["onboarding_completed"]
    client.patch(f"{API}/users/me", json={"tour_completed": True}, headers=hdr(world["s_user"]))
    assert _me(client, world["s_user"])["onboarding_completed"] == before


def test_patch_null_is_ignored_not_a_500(client, world):
    h = hdr(world["s_user"])
    client.patch(f"{API}/users/me", json={"tour_completed": True}, headers=h)
    r = client.patch(f"{API}/users/me", json={"tour_completed": None}, headers=h)
    assert r.status_code == 200, r.text
    assert _me(client, world["s_user"])["tour_completed"] is True   # null no cambia nada


def _load_migration(name):
    path = next(pathlib.Path(__file__).resolve().parents[2].joinpath("alembic/versions").glob(f"{name}*.py"))
    spec = importlib.util.spec_from_file_location("mig_" + name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run(engine, mod, fn):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(mod, fn)()


def test_migration_marks_existing_users_as_seen():
    eng = sa.create_engine("sqlite://")
    with eng.begin() as c:
        c.execute(sa.text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        c.execute(sa.text("INSERT INTO users (id) VALUES (1), (2), (3)"))
    mod = _load_migration("f28a1b2c3d4e")
    _run(eng, mod, "upgrade")
    with eng.begin() as c:
        assert [r[0] for r in c.execute(sa.text("SELECT tour_completed FROM users ORDER BY id"))] == [1, 1, 1]
        c.execute(sa.text("INSERT INTO users (id) VALUES (4)"))   # cuenta nueva: la guía queda pendiente
        assert c.execute(sa.text("SELECT tour_completed FROM users WHERE id = 4")).scalar() == 0
    _run(eng, mod, "downgrade")
    with eng.connect() as c:
        assert "tour_completed" not in [r[1] for r in c.execute(sa.text("PRAGMA table_info(users)"))]
