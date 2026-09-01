from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from typing import Optional
from app.db.base import get_db
from app.auth.jwt import decode_access_token
from app.models.user import User, UserRole
from app.models.teacher import TeacherStatus

# Extrae el token del header "Authorization: Bearer <token>"
security = HTTPBearer()
# Igual, pero no rechaza la request si no viene token (auto_error=False)
optional_security = HTTPBearer(auto_error=False)

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """
    Dependencia base — verifica que el usuario está logueado.
    Se usa en cualquier endpoint que requiera autenticación.
    """
    token = credentials.credentials
    payload = decode_access_token(token)

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido o expirado"
        )

    user = db.query(User).filter(User.id == int(payload["sub"])).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario no encontrado"
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cuenta desactivada"
        )

    return user

def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(optional_security),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """
    Igual que get_current_user pero devuelve None en vez de lanzar 401
    cuando no hay token o es inválido. Se usa en endpoints que aceptan
    reportes tanto de usuarios logueados como anónimos (ej. reporte de
    errores de frontend, que puede ocurrir antes de loguearse).
    """
    if not credentials:
        return None
    payload = decode_access_token(credentials.credentials)
    if not payload:
        return None
    user = db.query(User).filter(User.id == int(payload["sub"])).first()
    if not user or not user.is_active:
        return None
    return user


def get_current_teacher(current_user: User = Depends(get_current_user)) -> User:
    """Permite acceso a profesores y a teacher_admin (actúan como profesores)"""
    if current_user.role not in [UserRole.teacher, UserRole.teacher_admin]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso solo para profesores"
        )
    return current_user

def get_current_student(current_user: User = Depends(get_current_user)) -> User:
    """Solo permite acceso a estudiantes"""
    if current_user.role != UserRole.student:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso solo para estudiantes"
        )
    return current_user

def get_current_staff(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    Permite acceso a superadmin Y teacher_admin.
    Para endpoints que ambos pueden usar.
    """
    if current_user.role not in [
        UserRole.superadmin,
        UserRole.teacher_admin
    ]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso solo para staff"
        )
    return current_user


def get_current_teacher_or_teacher_admin(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    Permite acceso a teacher Y teacher_admin.
    Para endpoints de gestión de clases propias.
    """
    if current_user.role not in [
        UserRole.teacher,
        UserRole.teacher_admin
    ]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso solo para profesores"
        )
    return current_user

def get_current_approved_teacher(current_user: User = Depends(get_current_user)) -> User:
    """
    Solo permite acceso a profesores con status='approved'.
    Se usa donde el profesor asigna material o tareas.
    """
    if current_user.role != UserRole.teacher:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso solo para profesores"
        )
    profile = current_user.teacher_profile
    if not profile or profile.status != TeacherStatus.approved:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tu cuenta de profesor debe estar aprobada para asignar material o tareas"
        )
    return current_user

def get_current_staff_or_teacher(current_user: User = Depends(get_current_user)) -> User:
    """
    Permite acceso a superadmin, teacher_admin y teacher.
    Se usa para aprobar renovaciones de paquete: el staff o el propio
    profesor del estudiante pueden confirmar el pago y activarla.
    """
    if current_user.role not in [
        UserRole.superadmin,
        UserRole.teacher_admin,
        UserRole.teacher,
    ]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso solo para staff o profesores"
        )
    return current_user