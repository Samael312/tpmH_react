"""Inventario «una prueba por ruta»: el registro de peticiones y el formato de las exenciones.

La comprobación de que cada ruta de la API recibe al menos una petición vive en `conftest.pytest_sessionfinish`
(solo en una ejecución completa de tests/audit). Aquí se prueba que el mecanismo funciona.
"""
from tests.audit import conftest as C
from tests.audit.helpers import API


def test_requests_are_recorded_with_route_template(client, world):
    C._ROUTES_HIT.discard(("GET", "/api/v1/users/me"))
    client.get(f"{API}/users/me")  # 401 también cuenta: la ruta existe y recibió la petición
    assert ("GET", "/api/v1/users/me") in C._ROUTES_HIT


def test_path_params_resolve_to_template(client, world):
    client.get(f"{API}/admin/teachers/999")
    assert ("GET", "/api/v1/admin/teachers/{teacher_id}") in C._ROUTES_HIT or any(
        m == "GET" and p.startswith("/api/v1/admin/teachers/{") for m, p in C._ROUTES_HIT
    )


def test_allowlist_entries_are_wellformed_and_justified():
    allkeys = C._all_route_keys()
    for (m, p), why in C._read_allowlist().items():
        assert (m, p) in allkeys, f"exención de una ruta inexistente: {m} {p}"
        assert why, f"exención sin motivo: {m} {p}"
