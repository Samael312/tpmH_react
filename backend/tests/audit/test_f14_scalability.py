"""Fase 14 — escalabilidad sin cambiar la estructura base."""
import time


def test_emails_leave_the_request_path_when_async(monkeypatch):
    """E1: con EMAIL_ASYNC el correo se encola y la petición no espera a Resend; al apagar, la cola se vacía."""
    import resend
    from app.core import email as email_mod
    from app.core.config import settings

    sent = []

    def slow_send(payload):
        time.sleep(0.3)
        sent.append(payload["to"])
        return {"id": "x"}

    monkeypatch.setattr(resend.Emails, "send", slow_send)
    monkeypatch.setattr(settings, "EMAIL_ASYNC", True)
    t0 = time.monotonic()
    assert email_mod._send("a@x.com", "Asunto", "<p>hola</p>") is True
    assert email_mod._send("b@x.com", "Asunto", "<p>hola</p>") is True
    assert time.monotonic() - t0 < 0.2  # no esperó a los 0,3 s de cada envío
    email_mod.shutdown_email_queue(wait=True)
    assert sorted(sent) == ["a@x.com", "b@x.com"]


def test_emails_are_sent_inline_when_async_is_off(monkeypatch):
    import resend
    from app.core import email as email_mod
    from app.core.config import settings

    sent = []
    monkeypatch.setattr(resend.Emails, "send", lambda p: sent.append(p["to"]) or {"id": "x"})
    monkeypatch.setattr(settings, "EMAIL_ASYNC", False)
    assert email_mod._send("c@x.com", "Asunto", "<p>hola</p>") is True
    assert sent == ["c@x.com"]
