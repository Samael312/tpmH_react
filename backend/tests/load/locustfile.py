"""
Prueba de carga reproducible (Fase 14, E5). Ver README.md para el orden completo.

    locust -f tests/load/locustfile.py --host http://127.0.0.1:8001 \
        --headless -u 30 -r 2 -t 5m --csv tests/load/results/run

Dos tipos de usuario:
- `Student` (peso 4): inicia sesión una vez y luego alterna dashboard, ver
  huecos, chat con su profesor y reservar + cancelar (la reserva se cancela
  al momento para no agotar el paquete ni llenar la agenda).
- `Visitor` (peso 1): anónimo, landing y perfiles públicos.

Cada usuario simulado manda su propio `X-Forwarded-For`, como un usuario
real detrás del proxy de Railway: así el límite por IP (200/min, login
10/min) se aplica por usuario y no a toda la prueba.

Una reserva que choca con otra (409/400) cuenta como respuesta correcta en
su propia fila «book (choque)»: es el servidor rechazando bien, no un fallo.
"""
import json
import random
import uuid
from datetime import datetime, timedelta, timezone
from itertools import count

from locust import HttpUser, between, task

from common import SEED_FILE  # locust añade la carpeta del locustfile al path

API = "/api/v1"
SEED = json.loads(SEED_FILE.read_text(encoding="utf-8"))
_ids = count(1)


def _fake_ip(n: int) -> str:
    return f"10.77.{(n // 250) % 250}.{n % 250 + 1}"


def _future_date(min_days=3, max_days=20) -> str:
    d = datetime.now(timezone.utc) + timedelta(days=random.randint(min_days, max_days))
    return d.strftime("%Y-%m-%d")


class Student(HttpUser):
    weight = 4
    wait_time = between(1, 5)

    def on_start(self):
        n = next(_ids)
        self.me = SEED["students"][(n - 1) % len(SEED["students"])]
        self.client.headers["X-Forwarded-For"] = _fake_ip(n)
        r = self.client.post(f"{API}/auth/login", json={"login": self.me["username"], "password": SEED["password"]},
                             name="login")
        r.raise_for_status()
        self.client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
        self.conversation_id = None

    @task(5)
    def dashboard(self):
        # Lo que pide el dashboard del alumno al entrar (hooks/useStudentData.ts y el menú).
        for path in ("/users/me", "/users/me/teachers", "/packages/my-enrollments", "/classes/my-classes",
                     "/payments/booking-status", "/admin/platform-config",
                     "/chat/conversations/unread-count", "/support/tickets/me/unread-count"):
            self.client.get(f"{API}{path}", name=f"dashboard {path}")

    @task(3)
    def browse_slots(self):
        self.client.get(f"{API}/availability/{self.me['teacher']}/slots?date={_future_date()}&duration=50",
                        name="slots")

    @task(2)
    def chat(self):
        if self.conversation_id is None:
            r = self.client.get(f"{API}/chat/conversations/direct/{self.me['teacher']}", name="chat open")
            if r.status_code != 200:
                return
            self.conversation_id = r.json()["id"]
        cid = self.conversation_id
        self.client.get(f"{API}/chat/conversations", name="chat list")
        self.client.get(f"{API}/chat/conversations/{cid}/messages", name="chat messages")
        self.client.post(f"{API}/chat/conversations/{cid}/messages", name="chat send",
                         json={"content": "mensaje de prueba de carga", "client_id": uuid.uuid4().hex})
        self.client.post(f"{API}/chat/conversations/{cid}/read", name="chat read")

    @task(1)
    def book_and_cancel(self):
        r = self.client.get(f"{API}/availability/{self.me['teacher']}/slots?date={_future_date()}&duration=50",
                            name="slots")
        if r.status_code != 200:
            return
        free = [s for s in r.json() if s["is_available"] and not s["too_soon"] and not s["is_past"]]
        if not free:
            return
        slot = random.choice(free)
        with self.client.post(f"{API}/payments/book", name="book", catch_response=True, json={
            "teacher_username": self.me["teacher"], "enrollment_id": self.me["enrollment_id"],
            "start_time_utc": slot["start_time_utc"], "end_time_utc": slot["end_time_utc"],
            "duration_minutes": 50,
        }) as resp:
            if resp.status_code in (400, 409):
                resp.success()
                resp.request_meta["name"] = "book (choque)"
                return
            if resp.status_code != 201:
                resp.failure(f"{resp.status_code}: {resp.text[:200]}")
                return
            class_id = resp.json()["class_id"]
        self.client.delete(f"{API}/classes/{class_id}", name="cancel")


class Visitor(HttpUser):
    weight = 1
    wait_time = between(2, 8)

    def on_start(self):
        self.client.headers["X-Forwarded-For"] = _fake_ip(10_000 + next(_ids))

    @task(3)
    def landing(self):
        self.client.get(f"{API}/public/landing", name="public landing")

    @task(2)
    def teachers(self):
        self.client.get(f"{API}/teachers/", name="public teachers")
        self.client.get(f"{API}/teachers/{random.choice(SEED['teachers'])}", name="public teacher profile")
