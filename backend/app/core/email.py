import resend
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

resend.api_key = settings.RESEND_API_KEY


def send_password_reset_email(
    to_email: str,
    user_name: str,
    reset_token: str,
) -> bool:
    """
    Envía el email de recuperación de contraseña.
    El link expira en 1 hora.
    """
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={reset_token}"

    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Recuperar contraseña</h2>
        <p>Hola {user_name},</p>
        <p>Recibimos una solicitud para restablecer tu contraseña.</p>
        <p>Haz clic en el siguiente botón para crear una nueva contraseña:</p>
        <a href="{reset_url}"
           style="display: inline-block; padding: 12px 24px;
                  background-color: #000; color: #fff;
                  text-decoration: none; border-radius: 8px;
                  margin: 16px 0;">
            Restablecer contraseña
        </a>
        <p style="color: #666; font-size: 14px;">
            Este enlace expira en 1 hora.<br>
            Si no solicitaste esto, ignora este email.
        </p>
    </div>
    """

    try:
        resend.Emails.send({
            "from": settings.EMAIL_FROM,
            "to": to_email,
            "subject": "Restablecer contraseña — TPMH",
            "html": html,
        })
        return True
    except Exception as e:
        logger.error(f"Error enviando email de reset: {e}")
        return False


def send_class_confirmation_email(
    to_email: str,
    student_name: str,
    class_datetime_utc: str,
    teacher_name: str,
    duration_minutes: int,
) -> bool:
    """
    Notifica al estudiante que su clase fue confirmada.
    Nota: el frontend muestra la hora en zona local,
    aquí enviamos UTC y el estudiante convierte.
    """
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Clase confirmada ✅</h2>
        <p>Hola {student_name},</p>
        <p>Tu clase ha sido confirmada:</p>
        <ul>
            <li><strong>Profesor:</strong> {teacher_name}</li>
            <li><strong>Fecha/Hora (UTC):</strong> {class_datetime_utc}</li>
            <li><strong>Duración:</strong> {duration_minutes} minutos</li>
        </ul>
        <p>La clase se realizará por Google Meet.
           El enlace te lo enviará el profesor.</p>
    </div>
    """

    try:
        resend.Emails.send({
            "from": settings.EMAIL_FROM,
            "to": to_email,
            "subject": "Clase confirmada — TPMH",
            "html": html,
        })
        return True
    except Exception as e:
        logger.error(f"Error enviando confirmación de clase: {e}")
        return False

def send_class_booking_confirmation(
    to_email: str,
    student_name: str,
    teacher_name: str,
    subject: str,
    class_start_utc: str,
    duration_minutes: int,
) -> bool:
    """
    Notifica al estudiante que su reserva fue recibida.
    Se envía al pasar a estado 'pending'.
    """
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Reserva recibida 📅</h2>
        <p>Hola {student_name},</p>
        <p>Tu reserva ha sido registrada. Recuerda subir el comprobante
           de pago para confirmarla.</p>
        <ul>
            <li><strong>Profesor:</strong> {teacher_name}</li>
            <li><strong>Materia:</strong> {subject}</li>
            <li><strong>Fecha/Hora (UTC):</strong> {class_start_utc}</li>
            <li><strong>Duración:</strong> {duration_minutes} minutos</li>
        </ul>
        <p>Una vez el staff verifique tu pago recibirás el link de Google Meet.</p>
    </div>
    """
    try:
        resend.Emails.send({
            "from": settings.EMAIL_FROM,
            "to": to_email,
            "subject": "Reserva recibida — TPMH",
            "html": html,
        })
        return True
    except Exception as e:
        logger.error(f"Error enviando confirmación de reserva: {e}")
        return False


def send_class_confirmed_email(
    to_email: str,
    student_name: str,
    teacher_name: str,
    subject: str,
    class_start_utc: str,
    duration_minutes: int,
    meet_link: str,
) -> bool:
    """
    Notifica al estudiante que su pago fue validado y la clase está confirmada.
    Se envía al pasar a estado 'confirmed'.
    Incluye el link de Google Meet.
    """
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Clase confirmada ✅</h2>
        <p>Hola {student_name}, tu pago fue verificado.</p>
        <ul>
            <li><strong>Profesor:</strong> {teacher_name}</li>
            <li><strong>Materia:</strong> {subject}</li>
            <li><strong>Fecha/Hora (UTC):</strong> {class_start_utc}</li>
            <li><strong>Duración:</strong> {duration_minutes} minutos</li>
        </ul>
        <p><strong>Link de Google Meet:</strong></p>
        <a href="{meet_link}"
           style="display:inline-block; padding:12px 24px;
                  background:#000; color:#fff;
                  text-decoration:none; border-radius:8px;">
            Unirme a la clase
        </a>
        <p style="color:#666; font-size:14px; margin-top:16px;">
            Guarda este link — lo necesitarás el día de la clase.
        </p>
    </div>
    """
    try:
        resend.Emails.send({
            "from": settings.EMAIL_FROM,
            "to": to_email,
            "subject": "Clase confirmada — TPMH",
            "html": html,
        })
        return True
    except Exception as e:
        logger.error(f"Error enviando confirmación de clase: {e}")
        return False


def send_class_reminder_email(
    to_email: str,
    student_name: str,
    teacher_name: str,
    class_start_utc: str,
    meet_link: str,
    hours_before: int = 24,
) -> bool:
    """
    Recordatorio de clase. Se envía 24h antes.
    Se dispara desde un job programado (ver paso 7).
    """
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Recordatorio de clase 🔔</h2>
        <p>Hola {student_name},</p>
        <p>Tu clase con <strong>{teacher_name}</strong> es en
           <strong>{hours_before} horas</strong>.</p>
        <p><strong>Hora (UTC):</strong> {class_start_utc}</p>
        <a href="{meet_link}"
           style="display:inline-block; padding:12px 24px;
                  background:#000; color:#fff;
                  text-decoration:none; border-radius:8px;">
            Unirme a la clase
        </a>
    </div>
    """
    try:
        resend.Emails.send({
            "from": settings.EMAIL_FROM,
            "to": to_email,
            "subject": f"Recordatorio: clase en {hours_before}h — TPMH",
            "html": html,
        })
        return True
    except Exception as e:
        logger.error(f"Error enviando recordatorio: {e}")
        return False


def send_class_cancelled_email(
    to_email: str,
    student_name: str,
    class_start_utc: str,
    cancelled_by: str,  # "student" o "staff"
) -> bool:
    """Notifica la cancelación de una clase"""
    reason = (
        "cancelaste tu clase"
        if cancelled_by == "student"
        else "tu clase fue cancelada por el staff"
    )
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Clase cancelada ❌</h2>
        <p>Hola {student_name}, {reason}.</p>
        <p><strong>Fecha/Hora (UTC):</strong> {class_start_utc}</p>
        <p>Si tienes dudas, contacta al staff.</p>
    </div>
    """
    try:
        resend.Emails.send({
            "from": settings.EMAIL_FROM,
            "to": to_email,
            "subject": "Clase cancelada — TPMH",
            "html": html,
        })
        return True
    except Exception as e:
        logger.error(f"Error enviando cancelación: {e}")
        return False