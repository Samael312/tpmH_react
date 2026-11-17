"""Fase 7: control de correos (interruptores por categoria, contador diario, modo ahorro)."""
from datetime import date, timedelta

import pytest
import resend

from tests.audit.conftest import _mk_user, hdr
from app.core import email as email_mod
from app.core import email_settings as es
from app.models.payment_config import PlatformConfig
from app.models.email_log import EmailLog

API = "/api/v1"
URL = f"{API}/admin/email-settings"


@pytest.fixture
def outbox(monkeypatch):
    """Captura lo que llegaria a Resend."""
    box = []
    monkeypatch.setattr(resend.Emails, "send", lambda params, *a, **k: box.append(params) or {"id": "x"})
    return box


def welcome():
    return email_mod.send_welcome_email("a@x.com", "A", "student")  # categoria: welcome (media)


def reminder():
    return email_mod.send_class_reminder_email("a@x.com", "A", "Prof", "mañana", 24)  # class_reminders (muy alta)


def verification():
    return email_mod.send_verification_email("a@x.com", "A", "tok")  # esencial


def put(client, w, body):
    return client.put(URL, json=body, headers=hdr(w["admin"]))


def cfg_set(db, **kw):
    cfg = db.query(PlatformConfig).first()
    for k, v in kw.items():
        setattr(cfg, k, v)
    db.commit()


def fill(db, sent, category="welcome", day=None):
    for _ in range(sent):
        db.add(EmailLog(day=day or es.today(), category=category, outcome="sent"))
    db.commit()


def test_all_templates_have_a_category():
    import re
    src = open(email_mod.__file__, encoding="utf-8").read()
    funcs = set(re.findall(r"^def (send_\w+)\(", src, re.M))
    assert funcs == set(es.EMAIL_CATEGORY), funcs ^ set(es.EMAIL_CATEGORY)
    assert set(es.EMAIL_CATEGORY.values()) <= set(es.CATEGORIES)


def test_default_everything_is_sent(db, world, outbox):
    assert welcome() is True and reminder() is True and verification() is True
    assert len(outbox) == 3


def test_disabled_category_is_skipped_and_logged(client, db, world, outbox):
    r = put(client, world, {"notifications": {"welcome": False}})
    assert r.status_code == 200, r.text
    assert welcome() is False
    assert outbox == []
    assert reminder() is True  # las demas siguen encendidas
    usage = es.usage_today(db)
    assert usage["welcome"]["skipped"] == 1 and usage["welcome"].get("sent", 0) == 0


def test_essential_cannot_be_turned_off(client, db, world, outbox):
    r = put(client, world, {"notifications": {"essential": False}})
    assert r.status_code == 422
    assert verification() is True and len(outbox) == 1


def test_unknown_category_and_bad_numbers_rejected(client, world):
    assert put(client, world, {"notifications": {"nope": True}}).status_code == 422
    assert put(client, world, {"daily_limit": 0}).status_code == 422
    assert put(client, world, {"auto_saver_percent": 0}).status_code == 422
    assert put(client, world, {"auto_saver_percent": 101}).status_code == 422
    assert put(client, world, {"daily_limit": 1, "auto_saver_percent": 100}).status_code == 200


def test_counter_counts_only_sent(client, db, world, outbox, monkeypatch):
    welcome()
    welcome()
    put(client, world, {"notifications": {"welcome": False}})
    welcome()                                   # omitido: no cuenta
    put(client, world, {"notifications": {"welcome": True}})

    def boom(*a, **k):
        raise RuntimeError("cuota agotada")
    monkeypatch.setattr(resend.Emails, "send", boom)
    assert welcome() is False                   # fallido: no cuenta
    data = client.get(URL, headers=hdr(world["admin"])).json()
    assert data["sent_today"] == 2
    assert data["skipped_today"] == 1 and data["failed_today"] == 1 and data["alert"] is True
    cat = next(c for c in data["categories"] if c["key"] == "welcome")
    assert (cat["sent_today"], cat["skipped_today"], cat["failed_today"]) == (2, 1, 1)


def test_exact_daily_limit_100_ok_101_skipped(db, world, outbox):
    cfg_set(db, email_daily_limit=100)
    fill(db, 99)
    assert welcome() is True        # el correo 100 sale
    assert welcome() is False       # el 101 no
    assert len(outbox) == 1
    assert verification() is True   # las esenciales siempre salen


def test_auto_saver_pauses_very_high_and_high_but_not_essential(client, db, world, outbox):
    r = put(client, world, {"auto_saver_enabled": True, "auto_saver_percent": 80, "daily_limit": 100})
    assert r.status_code == 200
    fill(db, 79)
    assert reminder() is True                       # 79 % -> todavia no se pausa
    fill(db, 1)                                     # ahora 81 enviados -> >= 80 %
    assert reminder() is False                      # muy alta: pausada
    assert email_mod.send_class_cancelled_email("a@x.com", "A", "Prof", "mañana") is False  # alta: pausada
    assert welcome() is True                        # media: no se toca
    assert verification() is True                   # esencial: nunca
    data = client.get(URL, headers=hdr(world["admin"])).json()
    assert data["auto_saver_active"] is True


def test_auto_saver_off_by_default(db, world, outbox):
    fill(db, 90)
    assert reminder() is True


def test_day_change_resets_counter(db, world, outbox, monkeypatch):
    cfg_set(db, email_daily_limit=3)
    fill(db, 3)
    assert welcome() is False
    monkeypatch.setattr(es, "today", lambda: es.utc_now().date() + timedelta(days=1))
    assert welcome() is True


def test_only_superadmin(client, db, world):
    t = hdr(world["t_user"])
    s = hdr(world["s_user"])
    for h in (t, s):
        assert client.get(URL, headers=h).status_code == 403
        assert client.put(URL, json={}, headers=h).status_code == 403
    assert client.get(URL).status_code in (401, 403)
    ta = _mk_user(db, "teacher_admin", "tadmin")
    db.commit()
    assert client.get(URL, headers=hdr(ta)).status_code == 403
    assert client.get(URL, headers=hdr(world["admin"])).status_code == 200


def test_get_lists_all_categories_with_probability(client, world):
    data = client.get(URL, headers=hdr(world["admin"])).json()
    keys = {c["key"] for c in data["categories"]}
    assert keys == set(es.CATEGORIES)
    probs = {c["key"]: c["probability"] for c in data["categories"]}
    assert probs["class_reminders"] == "muy_alta" and probs["chat_messages"] == "muy_alta"
    assert data["daily_limit"] == 100 and data["auto_saver_enabled"] is False and data["auto_saver_percent"] == 80


def test_control_failure_still_sends(db, world, outbox, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("BD caida")
    monkeypatch.setattr(es, "decide", boom)
    assert welcome() is True and len(outbox) == 1
