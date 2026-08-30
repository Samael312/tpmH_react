from typing import Any, Optional
from sqlalchemy.orm import Session

from app.models.god_mode_audit import GodModeAuditLog
from app.models.user import User


def log_god_mode_action(
    db: Session,
    actor: User,
    action: str,
    entity_type: str,
    entity_id: int,
    reason: str,
    before: Optional[dict[str, Any]] = None,
    after: Optional[dict[str, Any]] = None,
) -> GodModeAuditLog:
    """
    Registra una acción del Modo Dios. No hace commit — el caller debe
    incluir este `db.add` en la misma transacción que el resto de los
    cambios de la operación, para que el log y la mutación real vivan
    o mueran juntos (si algo falla y se hace rollback, no queda un log
    huérfano de una acción que en realidad no se aplicó).

    Convención de `action`: "{entity_type}.{verbo}", ej:
      "class.force_status", "enrollment.adjust_credits",
      "cohort.move_student", "payment.edit_amount"

    `before` / `after` deben ser dicts serializables a JSON con solo
    los campos que cambiaron (no el objeto completo), para mantener el
    log legible.
    """
    if not reason or not reason.strip():
        raise ValueError("El Modo Dios requiere un motivo (reason) no vacío para cada acción.")

    log = GodModeAuditLog(
        actor_user_id=actor.id,
        actor_role=actor.role.value if hasattr(actor.role, "value") else str(actor.role),
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        reason=reason.strip(),
        before_data=before,
        after_data=after,
    )
    db.add(log)
    return log
