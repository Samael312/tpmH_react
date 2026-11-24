import resend
import threading
from concurrent.futures import ThreadPoolExecutor
from html import escape as _esc, unescape as _unescape
import functools
import inspect
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

resend.api_key = settings.RESEND_API_KEY

PLATFORM_NAME = "TuProfeMaria"
LOGO_URL = f"{settings.FRONTEND_URL}/assets/logo.png"

COLOR_PRIMARY = "#E91E8C"
COLOR_PRIMARY_LIGHT = "#F06DB3"
COLOR_INK = "#1a1a2e"
COLOR_MUTED = "#6B7280"
COLOR_SUBTLE = "#9CA3AF"
COLOR_SURFACE_SOFT = "#F8F9FA"
COLOR_BORDER = "#F1F3F5"
COLOR_GREEN = "#22C55E"
COLOR_AMBER = "#F59E0B"
COLOR_RED = "#EF4444"
COLOR_BLUE = "#3B82F6"
COLOR_PURPLE = "#8b5cf6"


# ─── Bloques reutilizables ────────────────────────────────────────────────────

def _detail_row(label: str, value: str) -> str:
    return f"""
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid {COLOR_BORDER};color:{COLOR_MUTED};font-size:13px;font-weight:600;font-family:Arial,sans-serif;">{label}</td>
      <td style="padding:9px 0;border-bottom:1px solid {COLOR_BORDER};color:{COLOR_INK};font-size:13px;font-weight:700;text-align:right;font-family:Arial,sans-serif;white-space:pre-wrap;">{value}</td>
    </tr>"""


def _detail_table(rows: list[str]) -> str:
    return f"""
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:20px 0;">
      {''.join(rows)}
    </table>"""


def _cta_button(text: str, url: str) -> str:
    return f"""
    <div style="text-align:center;margin:30px 0 12px;">
      <a href="{url}" target="_blank"
         style="display:inline-block;background:linear-gradient(135deg,{COLOR_PRIMARY},{COLOR_PRIMARY_LIGHT});
                color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;
                padding:14px 34px;border-radius:14px;font-family:Arial,sans-serif;
                box-shadow:0 8px 20px rgba(233,30,140,0.28);">
        {text}
      </a>
    </div>"""


def _badge(text: str, color: str) -> str:
    return f"""
    <span style="display:inline-block;background:{color}1a;color:{color};
                 font-size:11px;font-weight:800;letter-spacing:0.4px;text-transform:uppercase;
                 padding:5px 14px;border-radius:999px;font-family:Arial,sans-serif;">
      {text}
    </span>"""


def _base_template(preheader: str, badge_html: str, heading: str, body_html: str) -> str:
    return f"""
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{PLATFORM_NAME}</title>
</head>
<body style="margin:0;padding:0;background:{COLOR_SURFACE_SOFT};font-family:Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">{preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{COLOR_SURFACE_SOFT};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
          <tr>
            <td style="background:linear-gradient(135deg,{COLOR_PRIMARY},{COLOR_PRIMARY_LIGHT});
                       border-radius:28px 28px 0 0;padding:32px 32px 28px;text-align:center;">
              <img src="{LOGO_URL}" alt="{PLATFORM_NAME}" width="48" height="48"
                   style="border-radius:14px;background:#ffffff;padding:4px;display:inline-block;margin-bottom:10px;" />
              <div style="color:#ffffff;font-size:18px;font-weight:800;letter-spacing:-0.3px;">{PLATFORM_NAME}</div>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:36px 32px;border-radius:0 0 28px 28px;
                       box-shadow:0 20px 45px rgba(26,26,46,0.06);">
              <div style="margin-bottom:16px;">{badge_html}</div>
              <h1 style="margin:0 0 18px;font-size:22px;font-weight:800;color:{COLOR_INK};letter-spacing:-0.3px;">
                {heading}
              </h1>
              <div style="font-size:14px;line-height:1.65;color:{COLOR_MUTED};">
                {body_html}
              </div>
            </td>
          </tr>
          <tr>
            <td style="text-align:center;padding:24px 12px 8px;">
              <p style="font-size:11px;color:{COLOR_SUBTLE};font-weight:700;letter-spacing:0.4px;text-transform:uppercase;margin:0;">
                © {PLATFORM_NAME} Platform
              </p>
              <p style="font-size:11px;color:{COLOR_SUBTLE};margin:6px 0 0;">
                Recibiste este correo porque tienes una cuenta activa en {PLATFORM_NAME}.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


_email_executor = None
_email_executor_lock = threading.Lock()


def _get_email_executor() -> ThreadPoolExecutor:
    global _email_executor
    with _email_executor_lock:
        if _email_executor is None:
            _email_executor = ThreadPoolExecutor(max_workers=max(1, settings.EMAIL_WORKERS), thread_name_prefix="email")
        return _email_executor


def shutdown_email_queue(wait: bool = True) -> None:
    """Al apagar el servidor: deja salir los correos que estaban en cola (main.py::lifespan)."""
    global _email_executor
    with _email_executor_lock:
        executor, _email_executor = _email_executor, None
    if executor is not None:
        executor.shutdown(wait=wait)


def _plain_subject(subject: str) -> str:
    """El asunto es texto plano: se deshace el escape HTML de los datos del usuario y se quitan saltos de línea (inyección de cabeceras)."""
    return " ".join(_unescape(subject or "").split())[:200]


def _send(to_email: str, subject: str, html: str, category: str = "essential") -> bool:
    """
    Pone el correo en cola y vuelve al instante (Fase 14, E1): la peticion ya no espera a Resend. Devuelve True si
    quedo en cola; si sale, se omite o falla se anota igual en email_log desde el hilo de envio. Ningun llamador usa
    el valor devuelto. Con EMAIL_ASYNC=false se envia en linea y devuelve el resultado real.
    """
    subject = _plain_subject(subject)
    if not settings.EMAIL_ASYNC:
        return _send_now(to_email, subject, html, category)
    try:
        _get_email_executor().submit(_send_now, to_email, subject, html, category)
        return True
    except RuntimeError:
        # Cola cerrada (apagado en curso): se envia en linea para no perderlo.
        return _send_now(to_email, subject, html, category)


def _send_now(to_email: str, subject: str, html: str, category: str = "essential") -> bool:
    """
    Unico punto de salida de correos. Antes de enviar consulta el control de la Fase 7
    (core/email_settings.py): categoria apagada, limite diario o modo ahorro -> se omite y se anota.
    Si el control o el contador fallan, el correo SALE igual (nunca se pierde un correo por un fallo de conteo).
    """
    from app.core import email_settings
    from app.db.base import SessionLocal

    db = None
    try:
        db = SessionLocal()
        send, reason = email_settings.decide(db, category)
        if not send:
            email_settings.record(db, category, "skipped", reason)
            db.close()
            logger.info(f"Email omitido ({category}: {reason}) a {to_email}: {subject}")
            return False
    except Exception as e:
        logger.warning(f"Control de correos no disponible, se envia igual: {e}")
        if db is not None:
            db.rollback()

    ok = False
    try:
        resend.Emails.send({
            "from": settings.EMAIL_FROM,
            "to": to_email,
            "subject": subject,
            "html": html,
        })
        ok = True
    except Exception as e:
        logger.error(f"Error enviando email a {to_email} ({subject}): {e}")

    try:
        if db is not None:
            email_settings.record(db, category, "sent" if ok else "failed", None if ok else "error_resend")
    except Exception as e:
        logger.warning(f"No se pudo anotar el correo en email_log: {e}")
    finally:
        if db is not None:
            db.close()
    return ok


# ══════════════════════════════════════════════════════════════════════════
# AUTENTICACIÓN
# ══════════════════════════════════════════════════════════════════════════

def send_password_reset_email(to_email: str, user_name: str, reset_token: str) -> bool:
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={reset_token}"
    body = f"""
      <p>Hola {user_name},</p>
      <p>Recibimos una solicitud para restablecer tu contraseña. Este enlace expira en 1 hora.
      Si no fuiste tú, puedes ignorar este correo con total tranquilidad.</p>
      {_cta_button("Restablecer contraseña", reset_url)}
    """
    html = _base_template("Restablece tu contraseña", _badge("Seguridad", COLOR_BLUE), "Recuperar contraseña", body)
    return _send(to_email, f"Restablecer contraseña — {PLATFORM_NAME}", html, category="essential")


def send_verification_email(to_email: str, user_name: str, verify_token: str) -> bool:
    verify_url = f"{settings.FRONTEND_URL}/verify-email?token={verify_token}"
    body = f"""
      <p>Hola {user_name},</p>
      <p>Confirma que este correo es tuyo para poder pedir retiros, enviar pagos y vincular Google a tu cuenta.
      El enlace expira en 24 horas. Si no creaste una cuenta, ignora este mensaje.</p>
      {_cta_button("Verificar mi email", verify_url)}
    """
    html = _base_template("Verifica tu email", _badge("Seguridad", COLOR_BLUE), "Verifica tu email", body)
    return _send(to_email, f"Verifica tu email — {PLATFORM_NAME}", html, category="essential")


def send_username_recovery_email(to_email: str, user_name: str, username: str) -> bool:
    body = f"""
      <p>Hola {user_name},</p>
      <p>Recibimos una solicitud para recordarte tu nombre de usuario.</p>
      <div style="background:{COLOR_SURFACE_SOFT};border-radius:16px;padding:18px;margin:20px 0;text-align:center;">
        <p style="margin:0;font-size:12px;color:{COLOR_MUTED};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Tu nombre de usuario</p>
        <p style="margin:8px 0 0;font-size:22px;font-weight:800;color:{COLOR_PRIMARY};letter-spacing:-0.3px;">{username}</p>
      </div>
      <p>Si no fuiste tú, puedes ignorar este correo con total tranquilidad.</p>
    """
    html = _base_template("Recuperación de nombre de usuario", _badge("Seguridad", COLOR_BLUE), "Tu nombre de usuario 👤", body)
    return _send(to_email, f"Recuperación de usuario — {PLATFORM_NAME}", html, category="essential")


def send_welcome_email(to_email: str, user_name: str, role: str) -> bool:
    role_label = {"student": "Estudiante", "teacher": "Profesor(a)"}.get(role, "Usuario")
    next_steps = (
        "Explora nuestro catálogo de profesores y agenda tu primera clase de prueba — es gratis."
        if role == "student" else
        "Completa tu perfil público y configura tu disponibilidad para empezar a recibir estudiantes."
    )
    body = f"""
      <p>Hola {user_name}, ¡qué gusto tenerte aquí!</p>
      <p>Tu cuenta como <strong style="color:{COLOR_INK};">{role_label}</strong> ya está lista.</p>
      <div style="background:{COLOR_SURFACE_SOFT};border-radius:16px;padding:16px 18px;margin:18px 0;">
        <p style="margin:0;font-size:13px;color:{COLOR_INK};"><strong>Primer paso:</strong> {next_steps}</p>
      </div>
      {_cta_button("Ir a la plataforma", settings.FRONTEND_URL)}
    """
    html = _base_template("¡Bienvenido!", _badge("Bienvenida", COLOR_GREEN), f"¡Bienvenido, {user_name}! 🎉", body)
    return _send(to_email, f"¡Bienvenido a {PLATFORM_NAME}!", html, category="welcome")


# ══════════════════════════════════════════════════════════════════════════
# ESTUDIANTE
# ══════════════════════════════════════════════════════════════════════════

def _duration_and_buffer_rows(duration_minutes: int, buffer_minutes: int = 0) -> list:
    rows = [_detail_row("Duración", f"{duration_minutes} minutos")]
    if buffer_minutes:
        rows.append(_detail_row(
            "Margen de preparación",
            f"{buffer_minutes} minutos después de la clase, reservados para que "
            f"tu profesor(a) se prepare para su siguiente clase",
        ))
    return rows


def send_class_booking_confirmation(
    to_email: str, student_name: str, teacher_name: str, subject: str,
    class_start_local: str, duration_minutes: int, is_trial: bool = False,
    buffer_minutes: int = 0,
) -> bool:
    body = f"""
      <p>Hola {student_name},</p>
      <p>Tu {"clase de prueba" if is_trial else "reserva"} ha sido registrada.</p>
      {_detail_table([
        _detail_row("Profesor", teacher_name),
        _detail_row("Materia", subject),
        _detail_row("Fecha y hora", class_start_local),
        *_duration_and_buffer_rows(duration_minutes, buffer_minutes),
      ])}
      <p>Podrás ver el estado de tu clase desde tu panel en cualquier momento.</p>
      {_cta_button("Ver mis clases", f"{settings.FRONTEND_URL}/dashboard/classes")}
    """
    html = _base_template("Tu reserva fue registrada", _badge("Reserva recibida", COLOR_AMBER), "Reserva recibida 📅", body)
    return _send(to_email, f"Reserva recibida — {PLATFORM_NAME}", html, category="bookings")


def send_class_rescheduled_student_email(
    to_email: str, student_name: str, teacher_name: str,
    old_start_local: str, new_start_local: str, changed_by: str,
) -> bool:
    who = {"student": "tú", "teacher": "tu profesor(a)", "admin": "el equipo de soporte"}.get(changed_by, changed_by)
    body = f"""
      <p>Hola {student_name}, tu clase con <strong style="color:{COLOR_INK};">{teacher_name}</strong> fue reagendada por {who}.</p>
      {_detail_table([
        _detail_row("Horario anterior", old_start_local),
        _detail_row("Nuevo horario", new_start_local),
      ])}
      {_cta_button("Ver mis clases", f"{settings.FRONTEND_URL}/dashboard/classes")}
    """
    html = _base_template("Tu clase fue reagendada", _badge("Reagendada", COLOR_BLUE), "Clase reagendada 🔄", body)
    return _send(to_email, f"Clase reagendada — {PLATFORM_NAME}", html, category="cancellations")


def send_class_reminder_email(
    to_email: str, student_name: str, teacher_name: str, subject: str,
    class_start_local: str, hours_before: int = 24,
) -> bool:
    body = f"""
      <p>Hola {student_name},</p>
      <p>Tu clase con <strong style="color:{COLOR_INK};">{teacher_name}</strong> es en
      <strong style="color:{COLOR_PRIMARY};">{hours_before} horas</strong>.</p>
      {_detail_table([
        _detail_row("Materia", subject),
        _detail_row("Fecha y hora", class_start_local),
      ])}
      <p style="font-size:12px;color:{COLOR_SUBTLE};">Recuerda tener tu cámara y micrófono listos antes de conectarte.</p>
      {_cta_button("Ver mis clases", f"{settings.FRONTEND_URL}/dashboard/classes")}
    """
    html = _base_template(f"Tu clase es en {hours_before} horas", _badge("Recordatorio", COLOR_BLUE), "Recordatorio de clase 🔔", body)
    return _send(to_email, f"Recordatorio: clase en {hours_before}h — {PLATFORM_NAME}", html, category="class_reminders")


def send_cohort_ended_email(
    to_email: str, student_name: str, package_name: str, reason: str,
    credit_returned: bool | None = None,
) -> bool:
    """
    Para cuando una cohorte grupal termina y el alumno queda libre de
    elegir un nuevo paquete — a diferencia de una clase cancelada (que
    tiene una fecha/hora puntual), acá lo que se cancela es la cohorte
    completa, así que esta plantilla NO reutiliza el campo "Fecha y hora"
    de send_class_cancelled_email (antes se le pasaba ahí una oración en
    vez de un horario real, lo cual se leía sin sentido en el correo).
    `reason`: "below_minimum" | "teacher_cancelled".
    """
    reason_text = {
        "below_minimum": "el grupo no alcanzó el mínimo de alumnos necesario para continuar",
        "teacher_cancelled": "tu profesor(a) decidió no continuar con este grupo",
    }.get(reason, "tu grupo llegó a su fin")
    credit_line = ""
    if credit_returned is True:
        credit_line = f'<p style="font-size:13px;color:{COLOR_GREEN};font-weight:700;">✓ Tu pago queda disponible para elegir un nuevo paquete.</p>'
    body = f"""
      <p>Hola {student_name}, tu grupo de <strong style="color:{COLOR_INK};">{package_name}</strong> terminó porque {reason_text}.</p>
      {credit_line}
      <p style="font-size:13px;color:{COLOR_MUTED};">Puedes elegir un paquete individual u otro grupo con cupo disponible desde tu panel.</p>
      {_cta_button("Elegir nuevo paquete", f"{settings.FRONTEND_URL}/dashboard/schedule")}
    """
    html = _base_template("Tu grupo terminó", _badge("Grupo finalizado", COLOR_AMBER), "Tu grupo terminó 👥", body)
    return _send(to_email, f"Tu grupo de {package_name} terminó — {PLATFORM_NAME}", html, category="cancellations")


def send_class_cancelled_email(
    to_email: str, student_name: str, class_start_local: str, cancelled_by: str,
    reason: str | None = None, credit_returned: bool | None = None,
) -> bool:
    who = {"student": "cancelaste tu clase", "teacher": "tu profesor(a) canceló la clase", "staff": "el equipo canceló tu clase"}.get(cancelled_by, "tu clase fue cancelada")
    credit_line = ""
    if credit_returned is True:
        credit_line = f'<p style="font-size:13px;color:{COLOR_GREEN};font-weight:700;">✓ La clase fue devuelta a tu paquete.</p>'
    elif credit_returned is False:
        credit_line = f'<p style="font-size:13px;color:{COLOR_AMBER};font-weight:700;">Esta clase se descontó de tu paquete según nuestra política de cancelación.</p>'
    body = f"""
      <p>Hola {student_name}, {who}.</p>
      {_detail_table([_detail_row("Fecha y hora", class_start_local)])}
      {f'<p style="font-size:13px;color:{COLOR_MUTED};white-space:pre-wrap;"><strong>Motivo:</strong> {reason}</p>' if reason else ""}
      {credit_line}
      {_cta_button("Ir a la plataforma", settings.FRONTEND_URL)}
    """
    html = _base_template("Tu clase fue cancelada", _badge("Cancelada", COLOR_RED), "Clase cancelada ❌", body)
    return _send(to_email, f"Clase cancelada — {PLATFORM_NAME}", html, category="cancellations")


def send_class_no_show_email(to_email: str, student_name: str, class_start_local: str) -> bool:
    body = f"""
      <p>Hola {student_name}, tu profesor(a) marcó esta clase como inasistencia (no-show).</p>
      {_detail_table([_detail_row("Fecha y hora", class_start_local)])}
      <p>Esta clase fue descontada de tu paquete. Si crees que esto es un error o tuviste fuerza mayor, contacta a soporte.</p>
      {_cta_button("Contactar soporte", settings.FRONTEND_URL)}
    """
    html = _base_template("Inasistencia registrada", _badge("No-show", COLOR_AMBER), "Inasistencia registrada ⚠️", body)
    return _send(to_email, f"Inasistencia registrada — {PLATFORM_NAME}", html, category="cancellations")


def send_homework_graded_email(
    to_email: str, student_name: str, homework_title: str, score: float, feedback: str | None,
) -> bool:
    score_color = COLOR_GREEN if score >= 8 else (COLOR_AMBER if score >= 6 else COLOR_RED)
    body = f"""
      <p>Hola {student_name}, tu profesor(a) calificó tu tarea <strong style="color:{COLOR_INK};">"{homework_title}"</strong>.</p>
      <div style="text-align:center;margin:22px 0;">
        <span style="display:inline-block;font-size:32px;font-weight:900;color:{score_color};">{score}<span style="font-size:16px;color:{COLOR_SUBTLE};">/10</span></span>
      </div>
      {f'<div style="background:{COLOR_SURFACE_SOFT};border-radius:16px;padding:16px 18px;margin-top:8px;"><p style="margin:0;font-size:13px;color:{COLOR_INK};white-space:pre-wrap;"><strong>Retroalimentación:</strong> {feedback}</p></div>' if feedback else ''}
      {_cta_button("Ver mis tareas", f"{settings.FRONTEND_URL}/dashboard/homework")}
    """
    html = _base_template("Tu tarea fue calificada", _badge("Tarea calificada", COLOR_GREEN), "¡Tienes una nueva calificación! ⭐", body)
    return _send(to_email, f"Tarea calificada — {PLATFORM_NAME}", html, category="homework_materials")


def send_material_assigned_email(
    to_email: str, student_name: str, teacher_name: str, material_title: str, category: str,
) -> bool:
    body = f"""
      <p>Hola {student_name}, <strong style="color:{COLOR_INK};">{teacher_name}</strong> te asignó un nuevo material de estudio.</p>
      {_detail_table([
        _detail_row("Material", material_title),
        _detail_row("Categoría", category),
      ])}
      {_cta_button("Ver mis materiales", f"{settings.FRONTEND_URL}/dashboard/materials")}
    """
    html = _base_template("Nuevo material asignado", _badge("Nuevo material", COLOR_BLUE), "Nuevo material asignado 📚", body)
    return _send(to_email, f"Nuevo material asignado — {PLATFORM_NAME}", html, category="homework_materials")


def send_payment_receipt_email(
    to_email: str, student_name: str, concept: str, amount: float,
    payment_method: str, transaction_reference: str | None = None,
) -> bool:
    rows = [
        _detail_row("Concepto", concept),
        _detail_row("Monto", f"${amount:.2f}"),
        _detail_row("Método de pago", payment_method),
    ]
    if transaction_reference:
        rows.append(_detail_row("Referencia", transaction_reference))
    body = f"""
      <p>Hola {student_name}, confirmamos tu pago. ¡Gracias!</p>
      {_detail_table(rows)}
    """
    html = _base_template("Confirmación de pago", _badge("Pago aprobado", COLOR_GREEN), "Pago confirmado ✅", body)
    return _send(to_email, f"Pago confirmado — {PLATFORM_NAME}", html, category="receipts")


def send_payment_failed_email(
    to_email: str, student_name: str, concept: str, amount: float, rejection_reason: str,
) -> bool:
    body = f"""
      <p>Hola {student_name}, tu pago no pudo ser validado.</p>
      {_detail_table([
        _detail_row("Concepto", concept),
        _detail_row("Monto", f"${amount:.2f}"),
      ])}
      <p style="font-size:13px;color:{COLOR_RED};font-weight:700;white-space:pre-wrap;">Motivo: {rejection_reason}</p>
      {_cta_button("Reintentar pago", settings.FRONTEND_URL)}
    """
    html = _base_template("Tu pago no fue validado", _badge("Pago rechazado", COLOR_RED), "Pago rechazado", body)
    return _send(to_email, f"Pago rechazado — {PLATFORM_NAME}", html, category="receipts")


# ══════════════════════════════════════════════════════════════════════════
# PROFESOR
# ══════════════════════════════════════════════════════════════════════════

def send_teacher_status_update_email(
    to_email: str, teacher_name: str, new_status: str, reason: str | None = None,
) -> bool:
    STATUS_MAP = {
        "approved": ("Aprobado", COLOR_GREEN, "¡Tu perfil ya es público! Ya puedes recibir estudiantes."),
        "rejected": ("Rechazado", COLOR_RED, "Revisa el motivo y actualiza tu perfil para volver a enviarlo a revisión."),
        "suspended": ("Suspendido", COLOR_AMBER, "Tu perfil dejó de ser visible temporalmente. Contacta a soporte para más detalles."),
        "pending": ("En revisión", COLOR_BLUE, "Tu perfil está siendo revisado nuevamente por nuestro equipo."),
    }
    label, color, next_step = STATUS_MAP.get(new_status, (new_status, COLOR_MUTED, ""))
    body = f"""
      <p>Hola {teacher_name}, el estado de tu perfil ha sido actualizado.</p>
      {_detail_table([_detail_row("Nuevo estado", label)])}
      {f'<p style="font-size:13px;color:{COLOR_MUTED};white-space:pre-wrap;"><strong>Nota del equipo:</strong> {reason}</p>' if reason else ""}
      <p>{next_step}</p>
      {_cta_button("Ir a mi perfil", f"{settings.FRONTEND_URL}/teacher/profile")}
    """
    html = _base_template("Actualización de tu perfil", _badge(label, color), "Estado de tu perfil actualizado", body)
    return _send(to_email, f"Estado de tu perfil: {label} — {PLATFORM_NAME}", html, category="teacher_status_support")


from html import escape as _html_escape  # noqa: E402


def send_teacher_video_review_email(to_email: str, teacher_name: str, approved: bool, reason: str | None = None) -> bool:
    label, color = ("Video aprobado", COLOR_GREEN) if approved else ("Video rechazado", COLOR_RED)
    next_step = (
        "Tu video nuevo ya es el que ven los estudiantes en tu perfil público."
        if approved else
        "Tu video anterior sigue visible en tu perfil. Puedes subir otro video cuando quieras."
    )
    # Fuera del f-string de abajo: reutilizar la misma comilla dentro de un f-string solo es válido en Python 3.12+
    # y producción (Dockerfile) usa 3.11.
    reason_html = (
        f'<p style="font-size:13px;color:{COLOR_MUTED};white-space:pre-wrap;">'
        f'<strong>Motivo:</strong> {_html_escape(reason or "")}</p>'
        if reason else ""
    )
    body = f"""
      <p>Hola {teacher_name}, revisamos el video nuevo de tu perfil.</p>
      {_detail_table([_detail_row("Resultado", label)])}
      {reason_html}
      <p>{next_step}</p>
      {_cta_button("Ir a mi perfil", f"{settings.FRONTEND_URL}/teacher/profile")}
    """
    html = _base_template("Revisión de tu video", _badge(label, color), "Revisión de tu video", body)
    return _send(to_email, f"{label} — {PLATFORM_NAME}", html, category="teacher_status_support")


def send_support_ticket_response_email(
    to_email: str, user_name: str, subject: str, admin_response: str, portal_path: str,
) -> bool:
    body = f"""
      <p>Hola {user_name}, nuestro equipo respondió tu ticket de soporte.</p>
      {_detail_table([_detail_row("Asunto", subject)])}
      <p style="font-size:13px;color:{COLOR_MUTED};white-space:pre-wrap;"><strong>Respuesta del equipo:</strong> {admin_response}</p>
      {_cta_button("Ver mi ticket", f"{settings.FRONTEND_URL}{portal_path}")}
    """
    html = _base_template("Respondimos tu ticket de soporte", _badge("Respondido", COLOR_GREEN), "Tu ticket de soporte fue respondido 💬", body)
    return _send(to_email, f"Respondimos tu ticket: {subject} — {PLATFORM_NAME}", html, category="teacher_status_support")


def send_new_booking_teacher_email(
    to_email: str, teacher_name: str, student_first_name: str, student_last_name: str,
    student_nationality: str | None, student_phone: str | None, subject: str,
    class_start_local: str, duration_minutes: int, is_trial: bool = False,
    buffer_minutes: int = 0,
) -> bool:
    student_full_name = f"{student_first_name} {student_last_name}".strip()
    body = f"""
      <p>Hola {teacher_name}, tienes una nueva {"clase de prueba" if is_trial else "clase"} reservada.</p>
      {_detail_table([
        _detail_row("Estudiante", student_full_name),
        _detail_row("Nacionalidad", student_nationality or "No especificada"),
        _detail_row("Teléfono / WhatsApp", student_phone or "No especificado"),
        _detail_row("Materia", subject),
        _detail_row("Fecha y hora", class_start_local),
        *_duration_and_buffer_rows(duration_minutes, buffer_minutes),
      ])}
      {_cta_button("Ver mi agenda", f"{settings.FRONTEND_URL}/teacher/dashboard")}
    """
    html = _base_template("Nueva clase reservada", _badge("Prueba" if is_trial else "Nueva reserva", COLOR_BLUE if is_trial else COLOR_AMBER), "Nueva clase reservada 📥", body)
    return _send(to_email, f"Nueva reserva — {PLATFORM_NAME}", html, category="bookings")


def send_class_rescheduled_teacher_email(
    to_email: str, teacher_name: str, student_name: str,
    old_start_local: str, new_start_local: str, changed_by: str,
) -> bool:
    who = {"student": "tu estudiante", "teacher": "tú", "admin": "el equipo de soporte"}.get(changed_by, changed_by)
    body = f"""
      <p>Hola {teacher_name}, la clase con <strong style="color:{COLOR_INK};">{student_name}</strong> fue reagendada por {who}.</p>
      {_detail_table([
        _detail_row("Horario anterior", old_start_local),
        _detail_row("Nuevo horario", new_start_local),
      ])}
      {_cta_button("Ver mi agenda", f"{settings.FRONTEND_URL}/teacher/dashboard")}
    """
    html = _base_template("Una clase fue reagendada", _badge("Reagendada", COLOR_BLUE), "Clase reagendada 🔄", body)
    return _send(to_email, f"Clase reagendada — {PLATFORM_NAME}", html, category="cancellations")


def send_class_reminder_teacher_email(
    to_email: str, teacher_name: str, student_name: str, subject: str,
    class_start_local: str, hours_before: int = 24,
) -> bool:
    body = f"""
      <p>Hola {teacher_name},</p>
      <p>Tu clase con <strong style="color:{COLOR_INK};">{student_name}</strong> es en
      <strong style="color:{COLOR_PRIMARY};">{hours_before} horas</strong>.</p>
      {_detail_table([
        _detail_row("Materia", subject),
        _detail_row("Fecha y hora", class_start_local),
      ])}
      {_cta_button("Ver mi agenda", f"{settings.FRONTEND_URL}/teacher/dashboard")}
    """
    html = _base_template(f"Tu clase es en {hours_before} horas", _badge("Recordatorio", COLOR_BLUE), "Recordatorio de clase 🔔", body)
    return _send(to_email, f"Recordatorio: clase en {hours_before}h — {PLATFORM_NAME}", html, category="class_reminders")


def send_class_reminders_teacher_digest_email(
    to_email: str, teacher_name: str, items: list[tuple[str, str, str]], hours_before: int = 24,
) -> bool:
    """
    Un solo correo con TODAS las clases que el profesor tiene en la ventana de recordatorio, en vez de uno
    por clase. `items`: (alumno, materia, fecha y hora local).
    """
    rows = [_detail_row(f"{student} · {subject}", when) for student, subject, when in items]
    body = f"""
      <p>Hola {teacher_name}, tienes <strong style="color:{COLOR_PRIMARY};">{len(items)} clases</strong>
      en aproximadamente {hours_before} horas.</p>
      {_detail_table(rows)}
      {_cta_button("Ver mi agenda", f"{settings.FRONTEND_URL}/teacher/dashboard")}
    """
    html = _base_template(f"Tienes {len(items)} clases próximas", _badge("Recordatorio", COLOR_BLUE), "Recordatorio de clases 🔔", body)
    return _send(to_email, f"Recordatorio: {len(items)} clases en {hours_before}h — {PLATFORM_NAME}", html, category="class_reminders")


def send_chat_digest_teacher_email(
    to_email: str, teacher_name: str, items: list[tuple[str, int, str]], conversation_url: str,
) -> bool:
    """
    Un solo correo con los mensajes nuevos de varias conversaciones, en vez de uno por alumno.
    `items`: (alumno, mensajes sin leer, vista previa del ultimo).
    """
    total = sum(n for _s, n, _p in items)
    rows = [_detail_row(f"{student} ({n})", preview) for student, n, preview in items]
    body = f"""
      <p>Hola {teacher_name}, tienes <strong style="color:{COLOR_INK};">{total} mensajes nuevos</strong>
      de {len(items)} conversaciones en el chat interno.</p>
      {_detail_table(rows)}
      {_cta_button("Abrir el chat", conversation_url)}
    """
    html = _base_template("Mensajes nuevos", _badge("Chat", COLOR_BLUE), "Mensajes nuevos 💬", body)
    return _send(to_email, f"{total} mensajes nuevos en tu chat — {PLATFORM_NAME}", html, category="chat_messages")


def send_class_cancelled_teacher_email(
    to_email: str, teacher_name: str, student_name: str, class_start_local: str,
    cancelled_by: str, reason: str | None = None,
) -> bool:
    who = {"student": f"{student_name} canceló su clase", "teacher": "cancelaste esta clase", "staff": "el equipo canceló esta clase"}.get(cancelled_by, "esta clase fue cancelada")
    body = f"""
      <p>Hola {teacher_name}, {who}.</p>
      {_detail_table([
        _detail_row("Estudiante", student_name),
        _detail_row("Fecha y hora", class_start_local),
      ])}
      {f'<p style="font-size:13px;color:{COLOR_MUTED};white-space:pre-wrap;"><strong>Motivo:</strong> {reason}</p>' if reason else ""}
      {_cta_button("Ver mi agenda", f"{settings.FRONTEND_URL}/teacher/dashboard")}
    """
    html = _base_template("Una clase fue cancelada", _badge("Cancelada", COLOR_RED), "Clase cancelada ❌", body)
    return _send(to_email, f"Clase cancelada — {PLATFORM_NAME}", html, category="cancellations")


def send_homework_submitted_email(
    to_email: str, teacher_name: str, student_name: str, homework_title: str, submitted_at_local: str,
) -> bool:
    body = f"""
      <p>Hola {teacher_name}, <strong style="color:{COLOR_INK};">{student_name}</strong> entregó una tarea.</p>
      {_detail_table([
        _detail_row("Tarea", homework_title),
        _detail_row("Entregada", submitted_at_local),
      ])}
      {_cta_button("Ir a calificar", f"{settings.FRONTEND_URL}/teacher/homework")}
    """
    html = _base_template("Nueva entrega de tarea", _badge("Nueva entrega", COLOR_BLUE), "Nueva entrega para revisar 📝", body)
    return _send(to_email, f"Nueva entrega de tarea — {PLATFORM_NAME}", html, category="homework_materials")


def send_new_review_received_email(
    to_email: str, teacher_name: str, student_name: str, rating: float, comment: str | None,
) -> bool:
    stars = "⭐" * int(round(rating))
    body = f"""
      <p>Hola {teacher_name}, <strong style="color:{COLOR_INK};">{student_name}</strong> dejó una reseña sobre tus clases.</p>
      <div style="text-align:center;margin:18px 0;font-size:22px;">{stars} <span style="font-size:14px;color:{COLOR_MUTED};">({rating}/5)</span></div>
      {f'<div style="background:{COLOR_SURFACE_SOFT};border-radius:16px;padding:16px 18px;"><p style="margin:0;font-size:13px;color:{COLOR_INK};font-style:italic;white-space:pre-wrap;">"{comment}"</p></div>' if comment else ""}
      {_cta_button("Ver mi perfil público", f"{settings.FRONTEND_URL}/teacher/profile/preview")}
    """
    html = _base_template("Nueva reseña recibida", _badge("Nueva reseña", COLOR_PURPLE), "Nueva reseña recibida ⭐", body)
    return _send(to_email, f"Nueva reseña recibida — {PLATFORM_NAME}", html, category="reviews")


def send_calendar_reauth_teacher_email(to_email: str, teacher_name: str) -> bool:
    body = f"""
      <p>Hola {teacher_name}, Google rechazó el acceso a tu calendario (el permiso fue revocado o expiró).</p>
      <p>Mientras no lo reconectes, la sincronización con Google Calendar está detenida y las clases de Preply
      importadas dejaron de bloquear tu agenda.</p>
      {_cta_button("Reconectar Google Calendar", f"{settings.FRONTEND_URL}/teacher/profile")}
    """
    html = _base_template("Reconecta tu Google Calendar", _badge("Acción requerida", COLOR_BLUE), "Reconecta tu Google Calendar", body)
    return _send(to_email, f"Reconecta tu Google Calendar — {PLATFORM_NAME}", html, category="teacher_status_support")


def send_withdrawal_requested_teacher_email(
    to_email: str, teacher_name: str, amount: float, destination_method: str,
) -> bool:
    body = f"""
      <p>Hola {teacher_name}, recibimos tu solicitud de retiro.</p>
      {_detail_table([
        _detail_row("Monto solicitado", f"${amount:.2f}"),
        _detail_row("Método", destination_method),
      ])}
      <p>El equipo procesará tu solicitud en breve.</p>
      {_cta_button("Ver mis ganancias", f"{settings.FRONTEND_URL}/teacher/wallet")}
    """
    html = _base_template("Solicitud de retiro recibida", _badge("Retiro solicitado", COLOR_BLUE), "Solicitud de retiro recibida 💸", body)
    return _send(to_email, f"Solicitud de retiro recibida — {PLATFORM_NAME}", html, category="withdrawals")


def send_withdrawal_processed_email(
    to_email: str, teacher_name: str, status: str, amount: float,
    reference: str | None = None, rejection_reason: str | None = None,
) -> bool:
    is_completed = status == "completed"
    label = "Pagado" if is_completed else "Rechazado"
    color = COLOR_GREEN if is_completed else COLOR_RED
    rows = [_detail_row("Monto", f"${amount:.2f}")]
    if is_completed and reference:
        rows.append(_detail_row("Referencia", reference))
    body = f"""
      <p>Hola {teacher_name}, tu solicitud de retiro fue {"procesada" if is_completed else "rechazada"}.</p>
      {_detail_table(rows)}
      {f'<p style="font-size:13px;color:{COLOR_RED};font-weight:700;white-space:pre-wrap;">Motivo: {rejection_reason}</p>' if not is_completed and rejection_reason else ""}
      {_cta_button("Ver mis ganancias", f"{settings.FRONTEND_URL}/teacher/wallet")}
    """
    html = _base_template("Retiro procesado", _badge(label, color), f"Retiro {label.lower()}", body)
    return _send(to_email, f"Retiro {label.lower()} — {PLATFORM_NAME}", html, category="withdrawals")


# ══════════════════════════════════════════════════════════════════════════
# SUPERADMIN / STAFF
# ══════════════════════════════════════════════════════════════════════════

def send_admin_new_support_ticket_email(
    to_email: str, user_name: str, user_role_label: str, category_label: str, subject: str, message: str,
) -> bool:
    body = f"""
      <p>{user_name} ({user_role_label}) envió un nuevo ticket de soporte.</p>
      {_detail_table([
        _detail_row("Categoría", category_label),
        _detail_row("Asunto", subject),
      ])}
      <p style="font-size:13px;color:{COLOR_MUTED};white-space:pre-wrap;"><strong>Mensaje:</strong> {message}</p>
      {_cta_button("Ver bandeja de soporte", f"{settings.FRONTEND_URL}/admin/support")}
    """
    html = _base_template("Nuevo ticket de soporte", _badge("Pendiente", COLOR_AMBER), "Nuevo ticket de soporte 🎫", body)
    return _send(to_email, f"Nuevo ticket de soporte: {subject} — {PLATFORM_NAME}", html, category="admin_support_teachers")


def send_admin_new_teacher_pending_email(
    to_email: str, teacher_name: str, teacher_email: str, subjects_or_languages: list[str],
) -> bool:
    body = f"""
      <p>Un nuevo profesor completó su perfil y espera revisión.</p>
      {_detail_table([
        _detail_row("Nombre", teacher_name),
        _detail_row("Correo", teacher_email),
        _detail_row("Materias/Idiomas", ", ".join(subjects_or_languages) if subjects_or_languages else "No especificado"),
      ])}
      {_cta_button("Revisar profesor", f"{settings.FRONTEND_URL}/admin/teachers")}
    """
    html = _base_template("Nuevo profesor pendiente", _badge("Pendiente de revisión", COLOR_AMBER), "Nuevo profesor pendiente 👩‍🏫", body)
    return _send(to_email, f"Nuevo profesor pendiente — {PLATFORM_NAME}", html, category="admin_support_teachers")


def send_admin_payment_pending_email(
    to_email: str, student_name: str, amount: float, concept: str,
    payment_method: str, transaction_reference: str | None = None,
) -> bool:
    rows = [
        _detail_row("Estudiante", student_name),
        _detail_row("Concepto", concept),
        _detail_row("Monto", f"${amount:.2f}"),
        _detail_row("Método", payment_method),
    ]
    if transaction_reference:
        rows.append(_detail_row("Referencia", transaction_reference))
    body = f"""
      <p>Hay un pago esperando validación.</p>
      {_detail_table(rows)}
      {_cta_button("Revisar pago", f"{settings.FRONTEND_URL}/admin/payments")}
    """
    html = _base_template("Pago pendiente de revisión", _badge("Pendiente", COLOR_AMBER), "Pago pendiente de revisión 💳", body)
    return _send(to_email, f"Pago pendiente de revisión — {PLATFORM_NAME}", html, category="admin_payments")


def send_admin_withdrawal_requested_email(
    to_email: str, teacher_name: str, amount: float, destination_details: str,
) -> bool:
    body = f"""
      <p>Un profesor solicitó un retiro de sus ganancias.</p>
      {_detail_table([
        _detail_row("Profesor", teacher_name),
        _detail_row("Monto solicitado", f"${amount:.2f}"),
        _detail_row("Destino", destination_details),
      ])}
      {_cta_button("Procesar retiro", f"{settings.FRONTEND_URL}/admin/payments")}
    """
    html = _base_template("Nueva solicitud de retiro", _badge("Retiro pendiente", COLOR_AMBER), "Nueva solicitud de retiro 💸", body)
    return _send(to_email, f"Nueva solicitud de retiro — {PLATFORM_NAME}", html, category="withdrawals")

def send_package_expiring_email(
    to_email: str, student_name: str, package_name: str, classes_remaining: int,
) -> bool:
    plural = "clase" if classes_remaining == 1 else "clases"
    body = f"""
      <p>Hola {student_name},</p>
      <p>Tu paquete <strong style="color:{COLOR_INK};">{package_name}</strong> está por agotarse.</p>
      <div style="background:{COLOR_SURFACE_SOFT};border-radius:16px;padding:16px 18px;margin:18px 0;text-align:center;">
        <p style="margin:0;font-size:28px;font-weight:900;color:{COLOR_AMBER};">{classes_remaining}</p>
        <p style="margin:4px 0 0;font-size:12px;color:{COLOR_MUTED};font-weight:700;text-transform:uppercase;">{plural} restante{"s" if classes_remaining != 1 else ""}</p>
      </div>
      <p>Renueva ahora para no perder continuidad en tus clases.</p>
      {_cta_button("Renovar paquete", f"{settings.FRONTEND_URL}/dashboard/schedule")}
    """
    html = _base_template("Tu paquete está por agotarse", _badge("Por vencer", COLOR_AMBER), "Tu paquete se está agotando ⏳", body)
    return _send(to_email, f"Tu paquete está por agotarse — {PLATFORM_NAME}", html, category="package_expiring")

def send_new_chat_message_teacher_email(
    to_email: str, teacher_name: str, student_name: str, message_preview: str, conversation_url: str,
) -> bool:
    body = f"""
      <p>Hola {teacher_name}, tienes un nuevo mensaje de <strong style="color:{COLOR_INK};">{student_name}</strong> en el chat interno.</p>
      {_detail_table([
        _detail_row("Mensaje", message_preview),
      ])}
      {_cta_button("Responder", conversation_url)}
    """
    html = _base_template("Nuevo mensaje", _badge("Chat", COLOR_BLUE), "Nuevo mensaje 💬", body)
    return _send(to_email, f"Nuevo mensaje de {student_name} — {PLATFORM_NAME}", html, category="chat_messages")


def send_class_confirmed_email(
    to_email: str, student_name: str, teacher_name: str, subject: str,
    class_start_local: str, duration_minutes: int, buffer_minutes: int = 0,
) -> bool:
    body = f"""
      <p>Hola {student_name}, tu clase con <strong style="color:{COLOR_INK};">{teacher_name}</strong> está confirmada.</p>
      {_detail_table([
        _detail_row("Materia", subject),
        _detail_row("Fecha y hora", class_start_local),
        *_duration_and_buffer_rows(duration_minutes, buffer_minutes),
      ])}
      {_cta_button("Ver mis clases", f"{settings.FRONTEND_URL}/dashboard/classes")}
    """
    html = _base_template("Tu clase fue confirmada", _badge("Confirmada", COLOR_GREEN), "Clase confirmada ✅", body)
    return _send(to_email, f"Clase confirmada — {PLATFORM_NAME}", html, category="bookings")


def send_class_confirmed_teacher_email(
    to_email: str, teacher_name: str, student_name: str, subject: str,
    class_start_local: str, duration_minutes: int,
) -> bool:
    body = f"""
      <p>Hola {teacher_name}, tu clase con <strong style="color:{COLOR_INK};">{student_name}</strong> está confirmada.</p>
      {_detail_table([
        _detail_row("Materia", subject),
        _detail_row("Fecha y hora", class_start_local),
        _detail_row("Duración", f"{duration_minutes} minutos"),
      ])}
      {_cta_button("Ver mi agenda", f"{settings.FRONTEND_URL}/teacher/dashboard")}
    """
    html = _base_template("Una clase fue confirmada", _badge("Confirmada", COLOR_GREEN), "Clase confirmada ✅", body)
    return _send(to_email, f"Clase confirmada — {PLATFORM_NAME}", html, category="bookings")


# ─── Escape de HTML (Fase 21, S3) ─────────────────────────────────────────────
# Un solo punto: todas las funciones `send_*` pasan por este envoltorio, que escapa CADA argumento de texto
# (nombres, asuntos, mensajes, motivos, comentarios, títulos...) y los elementos de listas/tuplas antes de que
# lleguen a las plantillas. Se exceptúan los parámetros que son direcciones o rutas internas armadas por el
# servidor. El HTML intencional (botones, enlaces, negritas) vive en las plantillas, no en los argumentos.
# Las funciones nuevas con prefijo `send_` quedan cubiertas solas.
_RAW_PARAMS = frozenset({"to_email", "conversation_url", "portal_path", "verify_token", "reset_token"})


def _escape_value(v):
    if isinstance(v, str):
        return _esc(v)
    if isinstance(v, (list, tuple)):
        return type(v)(_escape_value(i) for i in v)
    return v


def _escaped_args(fn):
    sig = inspect.signature(fn)

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        bound = sig.bind(*args, **kwargs)
        for name, value in list(bound.arguments.items()):
            if name not in _RAW_PARAMS:
                bound.arguments[name] = _escape_value(value)
        return fn(*bound.args, **bound.kwargs)

    return wrapper


for _name, _fn in list(globals().items()):
    if _name.startswith("send_") and inspect.isfunction(_fn):
        globals()[_name] = _escaped_args(_fn)
