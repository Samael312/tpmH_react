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


def set_status(client, w, class_id, status):
    return client.patch(f"{API}/classes/{class_id}/status", json={"status": status}, headers=hdr(w["t_user"]))


def approve(client, w, payment_id):
    return client.patch(f"{API}/payments/{payment_id}/validate", json={"action": "approve"}, headers=hdr(w["admin"]))


def complete_trial(client, w, hours=24):
    """Agenda la prueba, la confirma y la marca completada. Devuelve class_id."""
    r = book(client, w, future(hours))
    assert r.status_code == 201, r.text
    cid = r.json()["class_id"]
    assert set_status(client, w, cid, "confirmed").status_code == 200
    assert set_status(client, w, cid, "completed").status_code == 200
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
