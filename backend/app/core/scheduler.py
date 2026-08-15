# app/core/scheduler.py

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy.orm import Session
from app.core.email import send_package_expiring_email
from app.models.package import Enrollment, EnrollmentStatus
from datetime import timedelta
import logging
from app.models.payment import Payment
from app.db.base import SessionLocal
from app.models.class_ import Class
from app.models.student import StudentProfile
from app.models.user import User
from app.core.timezone import utc_now, format_local_datetime
from app.core.class_logic import finalize_past_classes
from app.core.google_calendar import run_calendar_sync_for_all_teachers
from app.core.email import send_class_reminder_email, send_class_reminder_teacher_email

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

LOW_CREDIT_THRESHOLD = 1          # avisar cuando queda esta cantidad o menos
LOW_CREDIT_RENOTIFY_DAYS = 6      # no reavisar antes de este margen (protege si el job corre tarde)


async def finalize_expired_classes():
    """
    Job que se ejecuta cada 15 minutos.
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
        ).all()

        logger.info(f"Recordatorios: {len(upcoming)} clases en ventana 24h")

        for class_ in upcoming:
            try:
                student_profile = db.query(StudentProfile).filter(
                    StudentProfile.id == class_.student_id
                ).first()

                if not student_profile:
                    continue

                student_user = db.query(User).filter(
                    User.id == student_profile.user_id
                ).first()

                teacher_profile = class_.teacher
                teacher_user = db.query(User).filter(
                    User.id == teacher_profile.user_id
                ).first()

                if not student_user or not teacher_user:
                    continue

                send_class_reminder_email(
                    to_email=student_user.email,
                    student_name=student_user.name,
                    teacher_name=f"{teacher_user.name} {teacher_user.surname}",
                    class_start_local=format_local_datetime(class_.start_time_utc, student_profile.timezone),
                    hours_before=24,
                )

                send_class_reminder_teacher_email(
                    to_email=teacher_user.email,
                    teacher_name=teacher_user.name,
                    student_name=f"{student_user.name} {student_user.surname}",
                    class_start_local=format_local_datetime(class_.start_time_utc, teacher_profile.timezone),
                    hours_before=24,
                )

            except Exception as e:
                logger.error(
                    f"Error enviando recordatorio clase {class_.id}: {e}"
                )

    except Exception as e:
        logger.error(f"Error en job de recordatorios: {e}")
    finally:
        db.close()

async def expire_pending_class_payments():
    """
    Cada 10 min: expira clases en 'pending_payment' cuyo payment_expires_at
    ya pasó, libera el slot y marca el Payment asociado como rechazado.
    """
    db: Session = SessionLocal()
    try:
        now = utc_now()
        expired = db.query(Class).filter(
            Class.status == "pending_payment",
            Class.payment_expires_at.isnot(None),
            Class.payment_expires_at < now,
        ).all()

        for c in expired:
            c.status = "expired"
            c.payment_expires_at = None

            payment = db.query(Payment).filter(
                Payment.class_id == c.id, Payment.status == "pending_review"
            ).first()
            if payment:
                payment.status = "rejected"
                payment.rejection_reason = "Expiró el tiempo de validación del pago"

        if expired:
            db.commit()
            logger.info(f"Clases expiradas por falta de aprobación: {len(expired)}")
    except Exception as e:
        logger.error(f"Error expirando pagos pendientes: {e}")
    finally:
        db.close()

async def sync_all_teacher_calendars():
    """Sincroniza el calendario de todos los profesores conectados, cada hora."""
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
    si no se le avisó ya en los últimos LOW_CREDIT_RENOTIFY_DAYS días.
    """
    db: Session = SessionLocal()
    try:
        now = utc_now()
        enrollments = db.query(Enrollment).filter(
            Enrollment.status == EnrollmentStatus.active,
            Enrollment.payment_status.in_(["paid", "partially_paid"]),
        ).all()

        sent = 0
        for e in enrollments:
            is_unlimited = e.package.classes_count is None if e.package else False

            if is_unlimited:
                remaining = e.prepaid_unlimited_credits or 0
            else:
                remaining = max((e.unlocked_credits or 0) - (e.classes_used or 0), 0)

            if remaining > LOW_CREDIT_THRESHOLD:
                continue

            already_notified_recently = (
                e.low_credit_notified_at is not None
                and (now - e.low_credit_notified_at) < timedelta(days=LOW_CREDIT_RENOTIFY_DAYS)
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
    scheduler.add_job(expire_pending_class_payments, trigger=IntervalTrigger(minutes=10), id="expire_pending_payments", replace_existing=True)
    scheduler.add_job(sync_all_teacher_calendars, trigger=IntervalTrigger(hours=1), id="sync_teacher_calendars", replace_existing=True)
    scheduler.add_job(notify_low_credit_packages, trigger=IntervalTrigger(days=7), id="notify_low_credit_packages", replace_existing=True)
    scheduler.start()

def stop_scheduler():
    """Para el scheduler al apagar la aplicación"""
    scheduler.shutdown()