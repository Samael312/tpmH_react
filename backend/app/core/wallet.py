"""Escrituras atomicas de la billetera del profesor (Fase 20, D4).

Nunca se hace leer-modificar-escribir sobre el objeto ORM: dos peticiones simultaneas (aprobar pago, retirar,
God Mode) leian el mismo saldo y la ultima en escribir pisaba a la otra. Aqui el saldo se cambia con
`UPDATE ... SET col = col + :x`, que Postgres serializa por fila, y las bajadas llevan la guarda
`available_balance + :x >= 0` en el propio UPDATE.
"""
import math

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.payment import TeacherWallet


def _ensure_wallet_row(db: Session, teacher_id: int) -> None:
    if db.query(TeacherWallet.id).filter(TeacherWallet.teacher_id == teacher_id).first() is not None:
        return
    try:
        with db.begin_nested():
            db.add(TeacherWallet(teacher_id=teacher_id, available_balance=0.0, total_earned=0.0, total_withdrawn=0.0))
            db.flush()
    except IntegrityError:
        pass  # otra peticion la creo a la vez (teacher_id es unico): se usa la suya


def wallet_apply(
    db: Session, teacher_id: int, *, balance: float = 0.0, earned: float = 0.0, withdrawn: float = 0.0,
    allow_negative: bool = False,
) -> bool:
    """Suma (o resta, con signo negativo) a la billetera de forma atomica. No hace commit.

    Devuelve False, sin cambiar nada, si el saldo disponible quedaria negativo (salvo allow_negative=True).
    """
    for v in (balance, earned, withdrawn):
        if not math.isfinite(v):
            raise ValueError("Monto no finito en la billetera")
    balance, earned, withdrawn = round(balance, 2), round(earned, 2), round(withdrawn, 2)
    _ensure_wallet_row(db, teacher_id)
    query = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == teacher_id)
    if balance < 0 and not allow_negative:
        query = query.filter(TeacherWallet.available_balance + balance >= 0)
    changed = query.update(
        {
            TeacherWallet.available_balance: TeacherWallet.available_balance + balance,
            TeacherWallet.total_earned: TeacherWallet.total_earned + earned,
            TeacherWallet.total_withdrawn: TeacherWallet.total_withdrawn + withdrawn,
        },
        synchronize_session=False,
    )
    # Los objetos de billetera ya cargados en la sesion quedan viejos: se vuelven a leer al tocarlos.
    for obj in list(db.identity_map.values()):
        if isinstance(obj, TeacherWallet) and obj.teacher_id == teacher_id:
            db.expire(obj)
    return bool(changed)
