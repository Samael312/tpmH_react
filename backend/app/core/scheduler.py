from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy.orm import Session
from datetime import timedelta
import logging

from app.db.base import SessionLocal
from app.models.class_ import Class
from app.models.student import StudentProfile
from app.models.user import User
from app.core.timezone import utc_now
from app.core.email import send_class_reminder_email

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


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
                    class_start_utc=class_.start_time_utc.strftime(
                        "%Y-%m-%d %H:%M UTC"
                    ),
                    meet_link=class_.meet_link or "",
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


def start_scheduler():
    """Inicia el scheduler al arrancar la aplicación"""
    scheduler.add_job(
        send_class_reminders,
        trigger=IntervalTrigger(hours=1),
        id="class_reminders",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Scheduler iniciado — recordatorios cada hora")


def stop_scheduler():
    """Para el scheduler al apagar la aplicación"""
    scheduler.shutdown()