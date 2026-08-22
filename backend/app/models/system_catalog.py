from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.db.base import Base


class SystemCatalog(Base):
    """
    Catálogos configurables por el superadmin: listas de materias,
    idiomas, habilidades, objetivos de estudiante, métodos de pago,
    categorías/niveles de materiales, temas de paquetes, etc.
    Una fila por catálogo, identificada por `key`. El `value` es
    JSONB flexible (lista simple, lista de objetos, o dict).
    """
    __tablename__ = "system_catalogs"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, nullable=False, index=True)
    label = Column(String, nullable=False)          # nombre legible para el admin
    value = Column(JSONB, nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())