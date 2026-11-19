"""
Limpia lo que deja una corrida de la prueba de carga, sin tocar los usuarios
`lt_` (se reutilizan en la siguiente, como los usuarios fijos de tests/flow).

Uso (desde backend/):
    LOADTEST_DB_HOST=<host> python -m tests.load.cleanup

Borra solo filas de los profesores y alumnos `lt_`:
- clases canceladas de profesores `lt_` (cada reserva de la prueba se cancela
  al momento), con sus participantes, si ningún pago ni ticket las referencia;
- mensajes de chat de las conversaciones en las que participa un usuario `lt_`.

Para borrarlo TODO (usuarios incluidos), lo limpio es resetear la rama de
Neon desde la principal.
"""
from tests.load.common import PREFIX, add_backend_to_path, guard_database


def main() -> None:
    host = guard_database()
    add_backend_to_path()

    from sqlalchemy import text
    from app.db.base import engine

    like = f"{PREFIX}%"
    with engine.begin() as c:
        teacher_ids = [r[0] for r in c.execute(text(
            "SELECT tp.id FROM teacher_profiles tp JOIN users u ON u.id = tp.user_id "
            "WHERE u.username LIKE :p AND u.is_test_account"), {"p": like})]
        n_classes = 0
        if teacher_ids:
            ids = [r[0] for r in c.execute(text(
                "SELECT id FROM classes WHERE teacher_id = ANY(:t) AND status = 'cancelled' "
                "AND id NOT IN (SELECT class_id FROM payments WHERE class_id IS NOT NULL) "
                "AND id NOT IN (SELECT class_id FROM support_tickets WHERE class_id IS NOT NULL)"),
                {"t": teacher_ids})]
            if ids:
                c.execute(text("DELETE FROM class_participants WHERE class_id = ANY(:i)"), {"i": ids})
                n_classes = c.execute(text("DELETE FROM classes WHERE id = ANY(:i)"), {"i": ids}).rowcount
        n_msgs = c.execute(text(
            "DELETE FROM chat_messages WHERE sender_id IN "
            "(SELECT id FROM users WHERE username LIKE :p AND is_test_account)"), {"p": like}).rowcount
    print(f"[cleanup] BD {host}: {n_classes} clases canceladas y {n_msgs} mensajes borrados")


if __name__ == "__main__":
    main()
