from datetime import timedelta
from tests.audit.conftest import hdr, future

API = "/api/v1"


def iso(dt):
    return dt.isoformat()


def book(client, w, start, enrollment_id=None, duration=50, user=None):
    body = {
        "teacher_username": w["t_user"].username,
        "start_time_utc": iso(start),
        "end_time_utc": iso(start + timedelta(minutes=duration)),
        "duration_minutes": duration,
    }
    if enrollment_id:
        body["enrollment_id"] = enrollment_id
    return client.post(f"{API}/payments/book", json=body, headers=hdr(user or w["s_user"]))


def age_class(class_id, hours_ago=3):
    """Mueve la clase al pasado (AUD-04: solo se puede completar/no_show una clase ya empezada)."""
    from datetime import datetime, timezone
    from app.db.base import SessionLocal
    from app.models.class_ import Class
    s = SessionLocal()
    try:
        c = s.get(Class, class_id)
        c.start_time_utc = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
        c.end_time_utc = c.start_time_utc + timedelta(minutes=c.duration)
        s.commit()
    finally:
        s.close()


def set_status(client, w, class_id, status, age=False):
    if age:
        age_class(class_id)
    return client.patch(f"{API}/classes/{class_id}/status", json={"status": status}, headers=hdr(w["t_user"]))


def approve(client, w, payment_id):
    return client.patch(f"{API}/payments/{payment_id}/validate", json={"action": "approve"}, headers=hdr(w["admin"]))


def complete_trial(client, w, hours=24):
    """Agenda la prueba, la confirma y la marca completada. Devuelve class_id."""
    r = book(client, w, future(hours))
    assert r.status_code == 201, r.text
    cid = r.json()["class_id"]
    assert set_status(client, w, cid, "confirmed").status_code == 200
    assert set_status(client, w, cid, "completed", age=True).status_code == 200
    return cid


def buy_package(client, w, pkg=None, method="bank_transfer"):
    """Notifica y aprueba la compra del paquete. Devuelve (enrollment_id, payment_id)."""
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package", "package_id": (pkg or w["pkg"]).id,
        "payment_method": method, "transaction_reference": "AUD-1",
    }, headers=hdr(w["s_user"]))
    assert r.status_code == 200, r.text
    pid = r.json()["payment_id"]
    assert approve(client, w, pid).status_code == 200
    from app.db.base import SessionLocal
    from app.models.payment import Payment
    s = SessionLocal()
    try:
        return s.get(Payment, pid).enrollment_id, pid
    finally:
        s.close()


def ready_student(client, w):
    complete_trial(client, w)
    return buy_package(client, w)


def restrict_availability(db, w, start="08:00", end="20:00"):
    """Limita la disponibilidad del profesor (por defecto el mundo de pruebas tiene 24 h)."""
    from app.models.availability import TeacherAvailability
    db.query(TeacherAvailability).filter(TeacherAvailability.teacher_id == w["tp"].id).update(
        {"start_time_local": start, "end_time_local": end})
    db.commit()
