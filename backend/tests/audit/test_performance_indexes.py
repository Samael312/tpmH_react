"""Fase 11: los indices de rendimiento del modelo y los de la migracion son los mismos y existen en la BD."""
import importlib.util
from pathlib import Path

from sqlalchemy import inspect

import app.models  # noqa: F401  (registra los modelos y los indices)
from app.db.base import Base
from app.models.indexes import INDEX_SPECS

MIGRATION = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "b1d5e6f7a8c9_performance_indexes.py"


def _migration():
    spec = importlib.util.spec_from_file_location("perf_indexes_migration", MIGRATION)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_matches_models():
    mig = _migration()
    from_models = {(n, t, tuple(c)) for n, t, *c in INDEX_SPECS}
    from_migration = {(n, t, tuple(c)) for n, t, c in mig.INDEXES}
    assert from_models == from_migration


def test_names_are_unique():
    names = [s[0] for s in INDEX_SPECS]
    assert len(names) == len(set(names))


def test_indexes_are_declared_on_the_tables():
    for name, table, *cols in INDEX_SPECS:
        ix = next((i for i in Base.metadata.tables[table].indexes if i.name == name), None)
        assert ix is not None, name
        assert [c.name for c in ix.columns] == cols


def test_indexes_exist_in_a_fresh_database(tmp_path):
    from sqlalchemy import create_engine
    eng = create_engine(f"sqlite:///{tmp_path / 'ix.db'}")
    Base.metadata.create_all(eng)
    insp = inspect(eng)
    for name, table, *_ in INDEX_SPECS:
        assert name in {i["name"] for i in insp.get_indexes(table)}, name


def test_migration_chain_has_single_head_after_this_one():
    mig = _migration()
    assert mig.down_revision == "a9c4d5e6f7a8"
