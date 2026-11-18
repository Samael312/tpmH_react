"""
Cuota de almacenamiento de materiales por profesor (Fase 9).

Cada profesor puede guardar hasta MATERIALS_QUOTA_MB (500 por defecto) en materiales activos. Se comprueba
ANTES de enviar nada a Cloudinary. Borrar un material (is_active=False) libera su espacio. 0 desactiva la cuota.
Los materiales anteriores a esta fase no tienen `file_size` y cuentan 0.
El video de presentacion no entra aqui: es uno solo por profesor y al subir otro se borra el anterior.
"""
import os

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.material import Material
from app.models.teacher import TeacherProfile

MATERIALS_QUOTA_MB = int(os.getenv("MATERIALS_QUOTA_MB", "500"))


def quota_bytes() -> int:
    return max(MATERIALS_QUOTA_MB, 0) * 1024 * 1024


def get_upload_size(fileobj) -> int:
    """Tamano en bytes de un objeto tipo archivo sin cargarlo en memoria (deja el puntero al inicio)."""
    fileobj.seek(0, 2)
    size = fileobj.tell()
    fileobj.seek(0)
    return size


def used_bytes(db: Session, teacher_id: int) -> int:
    return int(db.query(func.coalesce(func.sum(Material.file_size), 0)).filter(
        Material.teacher_id == teacher_id, Material.is_active == True,  # noqa: E712
    ).scalar() or 0)


def usage(db: Session, teacher_id: int) -> dict:
    limit = quota_bytes()
    used = used_bytes(db, teacher_id)
    return {"used_bytes": used, "limit_bytes": limit, "unlimited": limit == 0,
            "remaining_bytes": None if limit == 0 else max(limit - used, 0)}


def ensure_quota(db: Session, teacher_id: int, new_size: int) -> None:
    """413 si subir `new_size` bytes superaria la cuota del profesor.

    Bloquea la fila del profesor (`FOR UPDATE`) hasta el commit del llamador: dos subidas simultaneas del MISMO
    profesor se ejecutan una tras otra, asi la segunda ve el espacio que ocupo la primera y la cuota no se puede
    superar por carrera. Los demas profesores no se ven afectados.
    """
    limit = quota_bytes()
    if limit == 0:
        return
    db.query(TeacherProfile.id).filter(TeacherProfile.id == teacher_id).with_for_update().first()
    if used_bytes(db, teacher_id) + new_size > limit:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Superas tu espacio de materiales ({MATERIALS_QUOTA_MB} MB). Elimina materiales que ya no uses para liberar espacio.",
        )
