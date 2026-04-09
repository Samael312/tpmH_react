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