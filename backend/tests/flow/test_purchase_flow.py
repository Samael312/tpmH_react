"""
Suite: Flujo completo de compra y reserva (el más largo e importante de
toda la app: prueba gratuita -> paquete -> validación de pago -> clase
regular con crédito descontado).

Nota de entorno: `/payments/book` resuelve el profesor mediante
`_resolve_booking_teacher`, que en modo single-tenant (o si no hay fila
`PlatformConfig` todavía) IGNORA `teacher_username` y usa el "featured
teacher" (`PlatformConfig.featured_teacher_id` o `settings.
FEATURED_TEACHER_USERNAME`). Si en tu entorno el profesor destacado no es
el profesor fijo de esta suite, este test se salta explícitamente en vez
de fallar de forma confusa — ver el skip de más abajo.
"""
import pytest
from datetime import datetime, timedelta, timezone as tz

from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.models.package import Package, Enrollment
from app.models.class_ import Class
from app.models.payment import Payment, TeacherWallet
from app.models.payment_config import PlatformConfig
from app.models.availability import TeacherAvailability
from tests.flow.conftest import auth_headers

pytestmark = [pytest.mark.integration, pytest.mark.destructive]


def _resolve_teacher_for_booking(db, fixed_username: str) -> str | None:
    """Réplica de _resolve_booking_teacher, solo para decidir si saltar el test."""
    config = db.query(PlatformConfig).first()
    if not config or config.is_single_tenant:
        if config and config.featured_teacher_id:
            t = db.query(TeacherProfile).filter(TeacherProfile.id == config.featured_teacher_id).first()
            return t.user_username if t else None
        import os
        return os.getenv("FEATURED_TEACHER_USERNAME") or None
    return fixed_username  # multi-tenant: sí se respeta el teacher_username explícito


@pytest.fixture
def clean_slate(db, fixed_users, volatile):
    """
    Se registra ANTES de crear nada: es la red de seguridad que garantiza
    que, pase lo que pase en el test, no queda ninguna Class/Enrollment/
    Payment/disponibilidad colgando, y que el saldo de la billetera del
    profesor fijo vuelve a como estaba (aprobar el pago del paquete le
    acredita comisión real). El orden de borrado (Payment -> Class ->
    Enrollment -> Package) se respeta a mano porque no hay FKs con
    ON DELETE CASCADE para estas tablas.
    """
    teacher = db.query(TeacherProfile).filter(TeacherProfile.user_id == fixed_users["teacher"].id).first()
    student = db.query(StudentProfile).filter(StudentProfile.user_id == fixed_users["student"].id).first()
    state = {"teacher_id": teacher.id, "student_id": student.id, "package_ids": []}

    wallet = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == teacher.id).first()
    original_wallet = None
    if wallet:
        original_wallet = {
            "available_balance": wallet.available_balance,
            "total_earned": wallet.total_earned,
            "total_withdrawn": wallet.total_withdrawn,
        }

    def _cleanup():
        from app.db.base import SessionLocal
        s = SessionLocal()
        try:
            s.query(Payment).filter(Payment.student_id == state["student_id"]).delete(synchronize_session=False)
            s.query(Class).filter(
                Class.teacher_id == state["teacher_id"], Class.student_id == state["student_id"]
            ).delete(synchronize_session=False)
            s.query(Enrollment).filter(
                Enrollment.teacher_id == state["teacher_id"], Enrollment.student_id == state["student_id"]
            ).delete(synchronize_session=False)
            if state["package_ids"]:
                s.query(Package).filter(Package.id.in_(state["package_ids"])).delete(synchronize_session=False)
            s.query(TeacherAvailability).filter(TeacherAvailability.teacher_id == state["teacher_id"]).delete(synchronize_session=False)

            if original_wallet is not None:
                w = s.query(TeacherWallet).filter(TeacherWallet.teacher_id == state["teacher_id"]).first()
                if w:
                    w.available_balance = original_wallet["available_balance"]
                    w.total_earned = original_wallet["total_earned"]
                    w.total_withdrawn = original_wallet["total_withdrawn"]
            s.commit()
        finally:
            s.close()

    volatile.custom(
        _cleanup,
        label="limpieza total: clases/enrollments/payments/packages/disponibilidad/billetera del par profesor-estudiante fijo",
    )
    return state


def test_full_trial_to_active_package_flow(
    client, db, teacher_token, student_token, superadmin_token, fixed_users, volatile, clean_slate,
):
    """
    Técnico: el flujo de negocio más largo de la app, verificado a nivel
    HTTP **y** BD en cada paso — disponibilidad semanal → reserva de
    prueba gratuita (primera clase con un profesor es siempre trial) →
    forzar "completada" vía god-mode → crear paquete → notificar pago →
    aprobar pago (verifica comisión calculada y billetera acreditada
    exactamente por amount_teacher) → reservar clase regular con el
    enrollment activo. Cada entidad creada (Class, Package, Payment,
    Enrollment) se verifica directo contra la BD, no solo por la respuesta
    del endpoint.
    UX: es el recorrido completo de un estudiante nuevo — probar gratis
    con un profesor, decidir comprar un paquete de clases, esperar que el
    equipo confirme el pago, y agendar su primera clase de verdad. Si
    cualquier eslabón de esta cadena se rompe, la plataforma no genera
    ingresos.
    """
    teacher_username = fixed_users["teacher"].username
    resolved = _resolve_teacher_for_booking(db, teacher_username)
    if resolved != teacher_username:
        pytest.skip(
            f"El profesor 'destacado' de este entorno es '{resolved}', no el profesor fijo "
            f"de pruebas ('{teacher_username}'). /payments/book siempre reserva con el "
            "destacado en modo single-tenant, así que este flujo no aplica aquí sin "
            "configurar PlatformConfig.featured_teacher_id o FEATURED_TEACHER_USERNAME."
        )

    # 1) Disponibilidad todo el día, toda la semana, para no pelear con huecos.
    r_avail = client.put("/api/v1/availability/me/weekly", json={
        "timezone": "UTC",
        "slots": [{"day_of_week": d, "start_time_local": "08:00", "end_time_local": "20:00"} for d in range(7)],
    }, headers=auth_headers(teacher_token))
    assert r_avail.status_code == 200, r_avail.text

    start = (datetime.now(tz.utc) + timedelta(days=4)).replace(hour=10, minute=0, second=0, microsecond=0)

    # 2) Primera reserva con este profesor = SIEMPRE prueba gratuita.
    r_book_trial = client.post("/api/v1/payments/book", json={
        "teacher_username": teacher_username,
        "start_time_utc": start.isoformat(),
        "end_time_utc": (start + timedelta(minutes=25)).isoformat(),
        "duration_minutes": 25,
    }, headers=auth_headers(student_token))
    assert r_book_trial.status_code == 201, r_book_trial.text
    trial = r_book_trial.json()
    assert trial["is_trial"] is True
    assert trial["status"] == "pending_trial"
    trial_class_id = trial["class_id"]

    # No se puede reservar una segunda prueba mientras la primera sigue pendiente.
    r_dup_trial = client.post("/api/v1/payments/book", json={
        "teacher_username": teacher_username,
        "start_time_utc": (start + timedelta(days=1)).isoformat(),
        "end_time_utc": (start + timedelta(days=1, minutes=25)).isoformat(),
        "duration_minutes": 25,
    }, headers=auth_headers(student_token))
    assert r_dup_trial.status_code == 400

    # 3) Staff marca la prueba como completada (god-mode: en la vida real
    # pasan los 25 minutos y el profesor la marca; aquí lo forzamos).
    r_force = client.patch(
        f"/api/v1/god-mode/classes/{trial_class_id}/force-status",
        json={"status": "completed", "reason": "flow-tests: completar prueba automáticamente"},
        headers=auth_headers(superadmin_token),
    )
    assert r_force.status_code == 200, r_force.text
    assert r_force.json()["status"] == "completed"

    # Verificación a nivel BD (no solo la respuesta del endpoint): la
    # clase de prueba existe de verdad, con el profesor/estudiante/tipo
    # correctos.
    db.expire_all()
    trial_db = db.query(Class).filter(Class.id == trial_class_id).first()
    assert trial_db is not None, "La clase de prueba debería existir en la BD"
    assert trial_db.status == "completed"
    assert trial_db.class_type.value == "trial"
    assert trial_db.teacher_id == clean_slate["teacher_id"]
    assert trial_db.student_id == clean_slate["student_id"]

    # 4) Ahora el estudiante necesita un paquete. El profesor crea uno.
    r_pkg = client.post("/api/v1/packages/", json={
        "name": "Flow-test package", "subject": "English", "price": 100.0,
        "classes_count": 4, "duration_minutes": 50,
    }, headers=auth_headers(teacher_token))
    assert r_pkg.status_code == 201, r_pkg.text
    package_id = r_pkg.json()["id"]
    clean_slate["package_ids"].append(package_id)

    package_db = db.query(Package).filter(Package.id == package_id).first()
    assert package_db is not None
    assert package_db.teacher_id == clean_slate["teacher_id"]
    assert package_db.classes_count == 4
    assert package_db.price == 100.0

    # Reservar clase regular ANTES de tener paquete debe fallar con "needs_package".
    r_needs_pkg = client.post("/api/v1/payments/book", json={
        "teacher_username": teacher_username,
        "start_time_utc": (start + timedelta(days=2)).isoformat(),
        "end_time_utc": (start + timedelta(days=2, minutes=50)).isoformat(),
        "duration_minutes": 50,
    }, headers=auth_headers(student_token))
    assert r_needs_pkg.status_code == 400

    # 5) El estudiante "compra" el paquete (notifica el pago).
    wallet_before = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == clean_slate["teacher_id"]).first()
    balance_before = wallet_before.available_balance if wallet_before else 0.0

    r_notify = client.post("/api/v1/payments/notify-payment", json={
        "type": "package", "package_id": package_id, "transaction_reference": "flow-tests-ref",
    }, headers=auth_headers(student_token))
    assert r_notify.status_code == 200, r_notify.text
    payment_id = r_notify.json()["payment_id"]

    # Verificación BD: el Payment se creó de verdad, apuntando al par
    # profesor-estudiante correcto, en estado pendiente de revisión.
    db.expire_all()
    payment_db = db.query(Payment).filter(Payment.id == payment_id).first()
    assert payment_db is not None, "El Payment debería existir en la BD"
    assert payment_db.student_id == clean_slate["student_id"]
    assert payment_db.teacher_id == clean_slate["teacher_id"]
    assert payment_db.amount_total == 100.0
    assert payment_db.status == "pending_review"

    # 6) Staff aprueba el pago -> el enrollment queda activo con créditos.
    r_validate = client.patch(f"/api/v1/payments/{payment_id}/validate", json={
        "action": "approve",
    }, headers=auth_headers(superadmin_token))
    assert r_validate.status_code == 200, r_validate.text

    # Verificación BD: el pago quedó aprobado, con comisión calculada
    # según TeacherProfile.commission_rate (15% por defecto), y la
    # billetera del profesor se acreditó exactamente por amount_teacher.
    db.expire_all()
    payment_db = db.query(Payment).filter(Payment.id == payment_id).first()
    assert payment_db.status == "approved"
    teacher_profile = db.query(TeacherProfile).filter(TeacherProfile.id == clean_slate["teacher_id"]).first()
    expected_commission = round(100.0 * teacher_profile.commission_rate, 2)
    expected_teacher_amount = round(100.0 - expected_commission, 2)
    assert payment_db.amount_platform == expected_commission
    assert payment_db.amount_teacher == expected_teacher_amount

    wallet_after = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == clean_slate["teacher_id"]).first()
    assert wallet_after is not None, "Debería haberse creado/actualizado la billetera del profesor"
    assert round(wallet_after.available_balance - balance_before, 2) == expected_teacher_amount, (
        "La billetera del profesor debería haberse acreditado exactamente por amount_teacher"
    )

    r_enrollments = client.get("/api/v1/packages/my-enrollments", headers=auth_headers(student_token))
    assert r_enrollments.status_code == 200
    enrollments = [e for e in r_enrollments.json() if e["package_id"] == package_id]
    assert len(enrollments) == 1, f"Debería haber exactamente 1 enrollment del paquete recién comprado: {r_enrollments.json()}"
    enrollment = enrollments[0]
    assert enrollment["status"] == "active"
    enrollment_id = enrollment["id"]

    # Verificación BD del enrollment: pertenece al par correcto, con los
    # créditos totales del paquete y ninguno usado todavía, y pagado.
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db is not None
    assert enrollment_db.student_id == clean_slate["student_id"]
    assert enrollment_db.teacher_id == clean_slate["teacher_id"]
    assert enrollment_db.package_id == package_id
    assert enrollment_db.classes_total == 4
    assert enrollment_db.classes_used == 0
    assert enrollment_db.payment_status == "paid"

    # 7) Con el paquete activo, ya se puede reservar una clase regular.
    r_book_regular = client.post("/api/v1/payments/book", json={
        "enrollment_id": enrollment_id,
        "start_time_utc": (start + timedelta(days=3)).isoformat(),
        "end_time_utc": (start + timedelta(days=3, minutes=50)).isoformat(),
        "duration_minutes": 50,
    }, headers=auth_headers(student_token))
    assert r_book_regular.status_code == 201, r_book_regular.text
    assert r_book_regular.json()["status"] in ("pending", "confirmed")
    regular_class_id = r_book_regular.json()["class_id"]

    # Verificación BD final: la clase regular existe, ligada al enrollment
    # correcto, y el enrollment descontó exactamente 1 crédito.
    db.expire_all()
    regular_class_db = db.query(Class).filter(Class.id == regular_class_id).first()
    assert regular_class_db is not None
    assert regular_class_db.class_type.value == "regular"
    assert regular_class_db.enrollment_id == enrollment_id
    assert regular_class_db.teacher_id == clean_slate["teacher_id"]
    assert regular_class_db.student_id == clean_slate["student_id"]

    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    # Nota: esta app NO incrementa `classes_used` al reservar (solo se
    # actualiza al cancelar/completar, ver core/class_logic.py) — el
    # cupo disponible se calcula dinámicamente contando clases activas
    # del enrollment (ver book_class en payments.py). Verificamos eso.
    occupied_slots = db.query(Class).filter(
        Class.enrollment_id == enrollment_id,
        Class.status.notin_(["cancelled", "expired"]),
    ).count()
    assert occupied_slots == 1, "Debería haber exactamente 1 clase activa consumiendo un cupo del enrollment"

    # El resto de la limpieza (clases, enrollment, payment, package) ya
    # quedó registrado en el fixture `clean_slate` desde el principio.
