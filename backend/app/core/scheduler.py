# app/core/scheduler.py

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy.orm import Session
from app.core.email import send_package_expiring_email
from app.models.package import Enrollment, EnrollmentStatus
from datetime import timedelta
import logging
from app.db.base import SessionLocal
from app.models.class_ import Class, ClassType
from app.models.student import StudentProfile
from app.models.user import User
from app.core.timezone import utc_now, format_local_datetime
from app.core.class_logic import finalize_past_classes, get_business_rules
from app.core.google_calendar import run_calendar_sync_for_all_teachers
from app.core.calendar_sync import generate_meet_link_for_class
from app.core.email import send_class_reminder_email, send_class_reminder_teacher_email

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def finalize_expired_classes():
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

async def send_class_reminders():
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

        for class_ in upcoming:
            try:
                teacher_profile = class_.teacher
                teacher_user = db.query(User).filter(
                    User.id == teacher_profile.user_id
                ).first()
                if not teacher_user:
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

                    send_class_reminder_teacher_email(
                        to_email=teacher_user.email,
                        teacher_name=teacher_user.name,
                        student_name=f"{len(participants)} alumno(s) del grupo",
                        subject=class_.subject or "Clase",
                        class_start_local=format_local_datetime(class_.start_time_utc, teacher_profile.timezone),
                        hours_before=24,
                    )

                    class_.reminder_sent_at = now
                    db.commit()
                    continue

                student_profile = db.query(StudentProfile).filter(
                    StudentProfile.id == class_.student_id
                ).first()

                if not student_profile:
                    continue

                student_user = db.query(User).filter(
                    User.id == student_profile.user_id
                ).first()

                if not student_user:
                    continue

                send_class_reminder_email(
                    to_email=student_user.email,
                    student_name=student_user.name,
                    teacher_name=f"{teacher_user.name} {teacher_user.surname}",
                    subject=class_.subject or "Clase",
                    class_start_local=format_local_datetime(class_.start_time_utc, student_profile.timezone),
                    hours_before=24,
                )

                send_class_reminder_teacher_email(
                    to_email=teacher_user.email,
                    teacher_name=teacher_user.name,
                    student_name=f"{student_user.name} {student_user.surname}",
                    subject=class_.subject or "Clase",
                    class_start_local=format_local_datetime(class_.start_time_utc, teacher_profile.timezone),
                    hours_before=24,
                )

                class_.reminder_sent_at = now
                db.commit()

            except Exception as e:
                logger.error(
                    f"Error enviando recordatorio clase {class_.id}: {e}"
                )

    except Exception as e:
        logger.error(f"Error en job de recordatorios: {e}")
    finally:
        db.close()

async def generate_upcoming_meet_links():
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

async def sync_all_teacher_calendars():
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

async def notify_low_credit_packages():
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

def start_scheduler():
    scheduler.add_job(send_class_reminders, trigger=IntervalTrigger(hours=1), id="class_reminders", replace_existing=True)
    scheduler.add_job(finalize_expired_classes, trigger=IntervalTrigger(minutes=10), id="finalize_expired_classes", replace_existing=True)
    scheduler.add_job(sync_all_teacher_calendars, trigger=IntervalTrigger(minutes=30), id="sync_teacher_calendars", replace_existing=True)
    scheduler.add_job(generate_upcoming_meet_links, trigger=IntervalTrigger(minutes=5), id="generate_meet_links", replace_existing=True)
    scheduler.add_job(notify_low_credit_packages, trigger=IntervalTrigger(days=7), id="notify_low_credit_packages", replace_existing=True)
    scheduler.start()

def stop_scheduler():
    """Para el scheduler al apagar la aplicación"""
    scheduler.shutdown()