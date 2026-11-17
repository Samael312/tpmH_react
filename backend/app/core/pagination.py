"""Paginacion comun para listados que devuelven una lista simple.

Compatible hacia atras: sin parametros devuelve las primeras DEFAULT_LIMIT filas (tope de seguridad)
y la cabecera `X-Total-Count` indica el total real, para que el cliente sepa si hay mas.
"""
from fastapi import Query, Response

DEFAULT_LIMIT = 200
MAX_LIMIT = 500


class Pagination:
    def __init__(
        self,
        limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT, description="Maximo de filas a devolver"),
        offset: int = Query(0, ge=0, description="Filas a omitir"),
    ):
        self.limit = limit
        self.offset = offset


def paginate(query, page: Pagination, response: Response):
    """Aplica offset/limit a una consulta ya ordenada y anota el total en `X-Total-Count`."""
    response.headers["X-Total-Count"] = str(query.order_by(None).count())
    return query.offset(page.offset).limit(page.limit)
