# app/core/scheduler.py

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy.orm import Session
from app.core.email import send_package_expiring_email
from app.models.package import Enrollment, EnrollmentStatus
from datetime import datetime, timedelta
import logging
from app.db.base import SessionLocal
from app.models.class_ import Class, ClassType
from app.models.student import StudentProfile
from app.models.user import User
from app.core.timezone import utc_now, format_local_datetime
from app.core.class_logic import finalize_past_classes, get_business_rules
from app.core.google_calendar import run_calendar_sync_for_all_teachers
from app.core.calendar_sync import generate_meet_link_for_class
from app.core.email import (
    send_class_reminder_email, send_class_reminder_teacher_email, send_class_reminders_teacher_digest_email,
)

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


def finalize_expired_classes():
    """
    Job que se ejecuta cada 10 minutos.
    Marca como 'finalized' las clases confirmadas cuyo horario ya pasó.
    """
    db: Session = SessionLocal()
    try:
        count = finalize_past_classes(db)
        if count:
            logger.info(f"Clases finalizadas automáticamente: {count}")
    except Exception as e:
        logger.error(f"Error en job de finalización de clases: {e}")
    finally:
        db.close()

def send_class_reminders():
    """
    Job que se ejecuta cada hora.
    Busca clases confirmadas que empiezan en ~24h
    y envía el recordatorio si aún no se envió.
    """
    db: Session = SessionLocal()
    now = utc_now()

    try:
        # Clases que empiezan entre 23h y 25h desde ahora
        window_start = now + timedelta(hours=23)
        window_end = now + timedelta(hours=25)

        upcoming = db.query(Class).filter(
            Class.status == "confirmed",
            Class.start_time_utc >= window_start,
            Class.start_time_utc <= window_end,
            Class.reminder_sent_at.is_(None),
        ).all()

        logger.info(f"Recordatorios: {len(upcoming)} clases en ventana 24h")

        # Fase 9: el profesor recibe UN correo con todas sus clases de la ventana, no uno por clase.
        teacher_items: dict[int, dict] = {}

        def _skip_reminder(class_):
            # Sin destinatario no hay correo, pero se marca como tratada: si no, el job la volvia a
            # encontrar y reintentaba cada 10 min (despertando Neon) mientras siguiera en la ventana.
            class_.reminder_sent_at = now
            db.commit()

        def _queue_for_teacher(teacher_user, who: str, subject: str, when: str):
            entry = teacher_items.setdefault(teacher_user.id, {"user": teacher_user, "items": []})
            entry["items"].append((who, subject, when))

        for class_ in upcoming:
            try:
                teacher_profile = class_.teacher
                teacher_user = db.query(User).filter(
                    User.id == teacher_profile.user_id
                ).first()
                if not teacher_user:
                    _skip_reminder(class_)
                    continue

                if class_.class_type == "group":
                    # Sesión compartida: se recuerda a cada alumno inscrito
                    # (vía ClassParticipant, no Class.student_id, que es
                    # NULL para clases grupales) y UNA sola vez al profesor
                    # con el conteo total, en vez de un correo por alumno.
                    from app.models.class_participant import ClassParticipant

                    participants = (
                        db.query(ClassParticipant, StudentProfile, User)
                        .join(StudentProfile, ClassParticipant.student_id == StudentProfile.id)
                        .join(User, StudentProfile.user_id == User.id)
                        .filter(
                            ClassParticipant.class_id == class_.id,
                            ClassParticipant.attendance_status != "cancelled",
                        )
                        .all()
                    )

                    if not participants:
                        _skip_reminder(class_)
                        continue

                    for _participant, student_profile, student_user in participants:
                        send_class_reminder_email(
                            to_email=student_user.email,
                            student_name=student_user.name,
                            teacher_name=f"{teacher_user.name} {teacher_user.surname}",
                            subject=class_.subject or "Clase",
                            class_start_local=format_local_datetime(class_.start_time_utc, student_profile.timezone),
                            hours_before=24,
                        )

                    _queue_for_teacher(
                        teacher_user, f"{len(participants)} alumno(s) del grupo", class_.subject or "Clase",
                        format_local_datetime(class_.start_time_utc, teacher_profile.timezone),
                    )

                    class_.reminder_sent_at = now
                    db.commit()
                    continue

                student_profile = db.query(StudentProfile).filter(
                    StudentProfile.id == class_.student_id
                ).first()

                if not student_profile:
                    _skip_reminder(class_)
                    continue

                student_user = db.query(User).filter(
                    User.id == student_profile.user_id
                ).first()

                if not student_user:
                    _skip_reminder(class_)
                    continue

                send_class_reminder_email(
                    to_email=student_user.email,
                    student_name=student_user.name,
                    teacher_name=f"{teacher_user.name} {teacher_user.surname}",
                    subject=class_.subject or "Clase",
                    class_start_local=format_local_datetime(class_.start_time_utc, student_profile.timezone),
                    hours_before=24,
                )

                _queue_for_teacher(
                    teacher_user, f"{student_user.name} {student_user.surname}", class_.subject or "Clase",
                    format_local_datetime(class_.start_time_utc, teacher_profile.timezone),
                )

                class_.reminder_sent_at = now
                db.commit()

            except Exception as e:
                logger.error(
                    f"Error enviando recordatorio clase {class_.id}: {e}"
                )

        for entry in teacher_items.values():
            try:
                user, items = entry["user"], entry["items"]
                if len(items) == 1:
                    who, subject, when = items[0]
                    send_class_reminder_teacher_email(
                        to_email=user.email, teacher_name=user.name, student_name=who,
                        subject=subject, class_start_local=when, hours_before=24,
                    )
                else:
                    send_class_reminders_teacher_digest_email(
                        to_email=user.email, teacher_name=user.name, items=items, hours_before=24,
                    )
            except Exception as e:
                logger.error(f"Error enviando recordatorio agrupado al profesor {entry['user'].id}: {e}")

    except Exception as e:
        logger.error(f"Error en job de recordatorios: {e}")
    finally:
        db.close()

def send_chat_digests():
    """Job por vencimiento: un correo por profesor con sus conversaciones de chat pendientes (core/chat_digest.py)."""
    from app.core.chat_digest import send_pending_digests

    db: Session = SessionLocal()
    try:
        n = send_pending_digests(db)
        if n:
            logger.info(f"Resumenes de chat enviados: {n}")
    except Exception as e:
        logger.error(f"Error en job de resumen de chat: {e}")
    finally:
        db.close()


def generate_upcoming_meet_links():
    """
    Job que se ejecuta cada 5 minutos.
    Genera automáticamente el link de videollamada (Google Meet, vía el
    Calendar del profesor) para las clases confirmadas que empiezan
    dentro de la ventana configurada por el superadmin
    (meet_link_autogen_minutes en PlatformConfig, default 30 min) y
    todavía NO tienen un link asignado.

    Si la clase ya tiene un meet_link (cargado manualmente por el
    profesor o generado en una corrida anterior) no se toca — el
    profesor puede seguir editándolo a mano cuando quiera, incluso
    después de que se haya generado automáticamente.

    Si el profesor no tiene Google Calendar conectado, no hay forma de
    generar un link real: se deja sin asignar y la clase sigue
    funcionando igual (el profesor puede cargarlo manualmente).

    Las clases "external" (importadas desde Preply, ver
    core/google_calendar.py::import_external_classes_for_teacher) se
    excluyen a propósito: son puramente visuales para reflejar la
    agenda completa del profesor, y no deben mutar el evento original
    de Preply agregándole un Google Meet que nadie va a usar ahí.
    """
    db: Session = SessionLocal()
    now = utc_now()
    try:
        autogen_minutes = get_business_rules(db)["meet_link_autogen_minutes"]
        window_end = now + timedelta(minutes=autogen_minutes)

        upcoming = db.query(Class).filter(
            Class.status == "confirmed",
            Class.meet_link.is_(None),
            Class.start_time_utc > now,
            Class.start_time_utc <= window_end,
            Class.class_type != ClassType.external,
        ).all()

        generated = 0
        for class_ in upcoming:
            try:
                link = generate_meet_link_for_class(class_, db)
                if link:
                    class_.meet_link = link
                    generated += 1
                db.commit()  # persiste el link y/o el google_event_id nuevo aunque no haya link
            except Exception as e:
                logger.error(f"Error generando meet link automático para clase {class_.id}: {e}")
                db.rollback()

        if generated:
            logger.info(f"Meet links generados automáticamente: {generated}")

    except Exception as e:
        logger.error(f"Error en job de generación automática de meet links: {e}")
    finally:
        db.close()

# BUG-04/12 fix: se eliminó expire_pending_class_payments() — el estado
# 'pending_payment'/'expired' para clases regulares ya no puede producirse,
# porque el flujo de "reservar y notificar el pago después" fue eliminado
# (book_class ahora exige el crédito ya pagado/aprobado de antemano).

def sync_all_teacher_calendars():
    """
    Job que se ejecuta cada 30 minutos, en segundo plano, sin depender
    de que algún profesor tenga el panel abierto.

    Antes la sincronización "real" solo ocurría cuando el profesor
    cargaba su panel de Google Calendar y disparaba `POST /calendar/sync`
    manualmente (botón "Sincronizar ahora" en CalendarSync.tsx), más un
    barrido de respaldo cada 1 hora. Con este job, la sincronización
    (push de clases propias hacia Google + importación de eventos
    externos como Preply, ver `sync_calendar_logic`) corre siempre sola,
    y el botón manual queda solo como un "forzar ya" para el profesor
    que no quiere esperar al próximo ciclo.
    """
    db: Session = SessionLocal()
    try:
        run_calendar_sync_for_all_teachers(db)
    except Exception as e:
        logger.error(f"Error en job de sincronización de calendarios: {e}")
    finally:
        db.close()

def notify_low_credit_packages():
    """
    Job semanal. Revisa enrollments activos con pocas clases restantes
    (finitos o ilimitados con crédito prepagado) y avisa al estudiante
    si no se le avisó ya dentro de la ventana configurada por el
    superadmin (low_credit_renotify_days en PlatformConfig).
    """
    db: Session = SessionLocal()
    try:
        now = utc_now()
        rules = get_business_rules(db)
        low_credit_threshold = rules["low_credit_threshold"]
        low_credit_renotify_days = rules["low_credit_renotify_days"]

        enrollments = db.query(Enrollment).filter(
            Enrollment.status == EnrollmentStatus.active,
            Enrollment.payment_status.in_(["paid", "partially_paid"]),
        ).all()

        sent = 0
        for e in enrollments:
            is_unlimited = e.package.classes_count is None if e.package else False
            remaining = (e.prepaid_unlimited_credits or 0) if is_unlimited else max((e.unlocked_credits or 0) - (e.classes_used or 0), 0)

            if remaining > low_credit_threshold:
                continue

            already_notified_recently = (
                e.low_credit_notified_at is not None
                and (now - e.low_credit_notified_at) < timedelta(days=low_credit_renotify_days)
            )
            if already_notified_recently:
                continue

            student_user = e.student.user if e.student else None
            if not student_user:
                continue

            send_package_expiring_email(
                to_email=student_user.email,
                student_name=student_user.name,
                package_name=e.package.name if e.package else "tu paquete",
                classes_remaining=remaining,
            )
            e.low_credit_notified_at = now
            sent += 1

        if sent:
            db.commit()
            logger.info(f"Avisos de paquete por vencer enviados: {sent}")
    except Exception as e:
        logger.error(f"Error en job de paquetes por vencer: {e}")
    finally:
        db.close()

def purge_old_chat_messages():
    """
    Job diario. Borra mensajes de chat interno más viejos que
    PlatformConfig.chat_retention_days (0 = sin límite, no borra nada).
    """
    from app.core.chat import purge_old_messages
    from app.core.platform_config import get_or_create_platform_config

    db: Session = SessionLocal()
    try:
        config = get_or_create_platform_config(db)
        count = purge_old_messages(db, config.chat_retention_days)
        if count:
            logger.info(f"Chat: {count} mensajes purgados por retención ({config.chat_retention_days}d)")
    except Exception as e:
        logger.error(f"Error en job de purga de chat: {e}")
    finally:
        db.close()


def release_stale_enrollments():
    """Job diario. Cancela los enrollments sin pagar de mas de 24 h (antes lo hacia un GET)."""
    from app.core.class_logic import release_stale_unpaid_enrollments

    db: Session = SessionLocal()
    try:
        n = release_stale_unpaid_enrollments(db)
        if n:
            logger.info(f"Enrollments sin pagar liberados: {n}")
    except Exception as e:
        logger.error(f"Error en job de enrollments sin pagar: {e}")
    finally:
        db.close()


def purge_old_logs():
    """Job diario. Purga `error_logs` y `email_log` por antiguedad (core/retention.py)."""
    from app.core.retention import purge_error_logs, purge_email_log

    db: Session = SessionLocal()
    try:
        errors = purge_error_logs(db)
        emails = purge_email_log(db)
        if errors or emails:
            logger.info(f"Retención: {errors} error_logs y {emails} email_log purgados")
    except Exception as e:
        logger.error(f"Error en job de purga de logs: {e}")
    finally:
        db.close()


# ─── Jobs "por vencimiento" (Fase 9) ─────────────────────────────────────────
#
# Un job de intervalo fijo (cada 5/10/30/60 min) consulta la BD aunque no haya nada
# que hacer, y mantiene despierta la base de Neon (que se suspende tras ~5 min sin consultas).
# Estos jobs en cambio calculan CUANDO les toca actuar (la hora exacta de la clase, de su fin,
# etc.) y se programan a si mismos con un DateTrigger. Si no hay nada pendiente duermen hasta
# `MAX_SLEEP`. Cuando se confirma una escritura de una clase (o de la config / un token de Google
# Calendar) la sesion avisa con `request_reschedule()` y se recalcula todo.

import threading
from dataclasses import dataclass
from typing import Callable, Optional

from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from sqlalchemy import event, func

from app.core.class_logic import CLASS_STATUS_WINDOW_HOURS

MAX_SLEEP = timedelta(hours=24)              # red de seguridad: como mucho 1 despertar al dia por job
CALENDAR_ACTIVE_WINDOW = timedelta(hours=3)  # sync cada 30 min mientras haya clase en curso o en las proximas 3 h
CALENDAR_ACTIVE_GAP = timedelta(minutes=30)
CALENDAR_IDLE_GAP = timedelta(hours=6)       # sin clases cerca: una sync cada 6 h
RESCHEDULE_ID = "reschedule_due_jobs"


@dataclass
class DueJob:
    id: str
    run: Callable[[], None]
    next_due: Callable[["DueJob", Session, datetime], Optional[datetime]]
    min_gap: timedelta                       # separacion minima entre dos ejecuciones (frena reintentos en bucle)
    last_run: Optional[datetime] = None


def _due_finalize(job: DueJob, db: Session, now: datetime) -> Optional[datetime]:
    """Primera clase que hay que cerrar: confirmed/pending_trial al terminar, finalized a las 72 h de terminar."""
    first_end = db.query(func.min(Class.end_time_utc)).filter(
        Class.status.in_(["confirmed", "pending_trial"])
    ).scalar()
    first_final = db.query(func.min(Class.end_time_utc)).filter(
        Class.status == "finalized", Class.class_type != ClassType.external,  # las externas se quedan finalized
    ).scalar()
    cands = []
    if first_end is not None:
        cands.append(first_end + timedelta(seconds=1))
    if first_final is not None:
        cands.append(first_final + timedelta(hours=CLASS_STATUS_WINDOW_HOURS, seconds=1))
    return min(cands) if cands else None


def _due_meet_links(job: DueJob, db: Session, now: datetime) -> Optional[datetime]:
    """
    Hora en que la proxima clase sin link entra en la ventana de autogeneracion. Solo cuentan los profesores con
    Google Calendar conectado: sin el, no se puede generar el link y el job reintentaba cada 5 min (despertando
    Neon) durante toda la ventana previa a cada clase.
    """
    from app.models.google_calendar import GoogleCalendarToken
    first = db.query(func.min(Class.start_time_utc)).join(
        GoogleCalendarToken, GoogleCalendarToken.teacher_id == Class.teacher_id,
    ).filter(
        GoogleCalendarToken.is_active == True,  # noqa: E712
        GoogleCalendarToken.needs_reauth == False,  # noqa: E712
        Class.status == "confirmed",
        Class.meet_link.is_(None),
        Class.start_time_utc > now,
        Class.class_type != ClassType.external,
    ).scalar()
    if first is None:
        return None
    return first - timedelta(minutes=get_business_rules(db)["meet_link_autogen_minutes"])


def _due_chat_digest(job: DueJob, db: Session, now: datetime) -> Optional[datetime]:
    from app.core.chat_digest import next_due
    return next_due(db)


def _due_reminders(job: DueJob, db: Session, now: datetime) -> Optional[datetime]:
    """Recordatorio 24 h antes: se envia en la ventana [23 h, 25 h] antes del inicio."""
    first = db.query(func.min(Class.start_time_utc)).filter(
        Class.status == "confirmed",
        Class.reminder_sent_at.is_(None),
        Class.start_time_utc >= now + timedelta(hours=23),
    ).scalar()
    if first is None:
        return None
    return first - timedelta(hours=25)


def _due_calendar_sync(job: DueJob, db: Session, now: datetime) -> Optional[datetime]:
    """
    Sin profesores con Calendar conectado no hay nada que sincronizar. Con clase en curso o en las
    proximas 3 h: cada 30 min. Si no: cada 6 h, y siempre antes de que la proxima clase entre en esa ventana.
    """
    from app.models.google_calendar import GoogleCalendarToken
    if not db.query(GoogleCalendarToken.id).filter(
        GoogleCalendarToken.is_active == True,  # noqa: E712
        GoogleCalendarToken.needs_reauth == False,  # noqa: E712
    ).first():
        return None
    last = job.last_run or now
    busy = db.query(Class.id).filter(
        Class.status == "confirmed",
        Class.end_time_utc > now,
        Class.start_time_utc <= now + CALENDAR_ACTIVE_WINDOW,
    ).first()
    if busy:
        return last + CALENDAR_ACTIVE_GAP
    nxt = db.query(func.min(Class.start_time_utc)).filter(
        Class.status == "confirmed",
        Class.start_time_utc > now + CALENDAR_ACTIVE_WINDOW,
    ).scalar()
    due = last + CALENDAR_IDLE_GAP
    if nxt is not None:
        due = min(due, nxt - CALENDAR_ACTIVE_WINDOW)
    return due


DUE_JOBS = [
    DueJob("finalize_expired_classes", finalize_expired_classes, _due_finalize, timedelta(minutes=5)),
    DueJob("generate_meet_links", generate_upcoming_meet_links, _due_meet_links, timedelta(minutes=5)),
    DueJob("class_reminders", send_class_reminders, _due_reminders, timedelta(minutes=10)),
    DueJob("chat_digest", send_chat_digests, _due_chat_digest, timedelta(minutes=5)),
    DueJob("sync_teacher_calendars", sync_all_teacher_calendars, _due_calendar_sync, timedelta(minutes=30)),
]
_JOBS_BY_ID = {j.id: j for j in DUE_JOBS}


def compute_run_at(job: DueJob, due: Optional[datetime], now: datetime) -> datetime:
    """Cuando programar la proxima ejecucion: `due` acotado a [ahora+1s, ahora+MAX_SLEEP] y respetando `min_gap`."""
    run_at = due if due is not None else now + MAX_SLEEP
    run_at = min(run_at, now + MAX_SLEEP)
    if job.last_run is not None:
        run_at = max(run_at, job.last_run + job.min_gap)
    return max(run_at, now + timedelta(seconds=1))


def reschedule_job(job: DueJob) -> None:
    """Recalcula (con una consulta corta) cuando le toca al job y lo programa. Nunca lanza."""
    now = utc_now()
    due: Optional[datetime]
    try:
        db: Session = SessionLocal()
        try:
            due = job.next_due(job, db, now)
        finally:
            db.close()
    except Exception as e:
        logger.error(f"No se pudo calcular el proximo vencimiento de {job.id}: {e}")
        due = now + timedelta(minutes=10)  # BD caida: reintentar mas tarde, no perder el job
    scheduler.add_job(
        _run_due_job, trigger=DateTrigger(run_date=compute_run_at(job, due, now)), args=[job.id], id=job.id,
        replace_existing=True, misfire_grace_time=3600, coalesce=True,
    )


def _run_due_job(job_id: str) -> None:
    job = _JOBS_BY_ID[job_id]
    try:
        job.run()
    finally:
        job.last_run = utc_now()
        reschedule_job(job)


def reschedule_all_due_jobs() -> None:
    for job in DUE_JOBS:
        reschedule_job(job)


def request_reschedule(delay_seconds: int = 3) -> None:
    """Pide recalcular los vencimientos (con un pequeño retraso: varias escrituras seguidas cuentan una vez)."""
    if not scheduler.running:
        return  # tests, scripts: no hay scheduler
    scheduler.add_job(
        reschedule_all_due_jobs, trigger=DateTrigger(run_date=utc_now() + timedelta(seconds=delay_seconds)),
        id=RESCHEDULE_ID, replace_existing=True, misfire_grace_time=60,
    )


# La sesion avisa SOLO cuando se confirma (commit) una escritura de algo que cambia los vencimientos.
_TOUCHED = "due_jobs_touched"
_hooks_installed = False
_hooks_lock = threading.Lock()


def _watched_models() -> tuple:
    from app.models.google_calendar import GoogleCalendarToken
    from app.models.payment_config import PlatformConfig
    return (Class, GoogleCalendarToken, PlatformConfig)


def _after_flush(session, flush_context) -> None:
    if any(isinstance(o, _watched_models()) for o in (*session.new, *session.dirty, *session.deleted)):
        session.info[_TOUCHED] = True


def _after_commit(session) -> None:
    if session.info.pop(_TOUCHED, False):
        request_reschedule()


def _after_soft_rollback(session, previous_transaction) -> None:
    session.info.pop(_TOUCHED, None)


def install_session_hooks() -> None:
    global _hooks_installed
    with _hooks_lock:
        if _hooks_installed:
            return
        event.listen(Session, "after_flush", _after_flush)
        event.listen(Session, "after_commit", _after_commit)
        event.listen(Session, "after_soft_rollback", _after_soft_rollback)
        _hooks_installed = True


def start_scheduler():
    install_session_hooks()
    scheduler.add_job(notify_low_credit_packages, trigger=CronTrigger(day_of_week="mon", hour=14, minute=0), id="notify_low_credit_packages", replace_existing=True)
    # Diarios a la misma hora (03:00 UTC) para despertar Neon una sola vez.
    scheduler.add_job(purge_old_chat_messages, trigger=CronTrigger(hour=3, minute=0), id="purge_old_chat_messages", replace_existing=True)
    scheduler.add_job(purge_old_logs, trigger=CronTrigger(hour=3, minute=5), id="purge_old_logs", replace_existing=True)
    scheduler.add_job(release_stale_enrollments, trigger=CronTrigger(hour=3, minute=10), id="release_stale_enrollments", replace_existing=True)
    # Los jobs por vencimiento se programan unos segundos despues de arrancar (fuera del camino critico).
    scheduler.add_job(
        reschedule_all_due_jobs, trigger=DateTrigger(run_date=utc_now() + timedelta(seconds=5)),
        id=RESCHEDULE_ID, replace_existing=True,
    )
    scheduler.start()

def stop_scheduler():
    """Para el scheduler al apagar la aplicación"""
    scheduler.shutdown()
