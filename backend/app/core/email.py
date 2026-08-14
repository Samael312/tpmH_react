import resend
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

resend.api_key = settings.RESEND_API_KEY

PLATFORM_NAME = "TuProfeMaria"
LOGO_URL = f"{settings.FRONTEND_URL}/assets/logo.png"

# ─── Paleta (igual que tailwind.config.ts) ───────────────────────────────────
COLOR_PRIMARY = "#E91E8C"
COLOR_PRIMARY_LIGHT = "#F06DB3"
COLOR_PRIMARY_DARK = "#C0166F"
COLOR_INK = "#1a1a2e"
COLOR_MUTED = "#6B7280"
COLOR_SUBTLE = "#9CA3AF"
COLOR_SURFACE_SOFT = "#F8F9FA"
COLOR_BORDER = "#F1F3F5"
COLOR_GREEN = "#22C55E"
COLOR_AMBER = "#F59E0B"
COLOR_RED = "#EF4444"
COLOR_BLUE = "#3B82F6"


# ─── Bloques reutilizables ────────────────────────────────────────────────────

def _detail_row(label: str, value: str) -> str:
    return f"""
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid {COLOR_BORDER};color:{COLOR_MUTED};font-size:13px;font-weight:600;font-family:Arial,sans-serif;">{label}</td>
      <td style="padding:9px 0;border-bottom:1px solid {COLOR_BORDER};color:{COLOR_INK};font-size:13px;font-weight:700;text-align:right;font-family:Arial,sans-serif;">{value}</td>
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
    """Envoltorio de marca: header con logo + gradiente, tarjeta blanca, footer."""
    return f"""
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{PLATFORM_NAME}</title>
</head>
<body style="margin:0;padding:0;background:{COLOR_SURFACE_SOFT};font-family:Arial,sans-serif;">
  <!-- preheader oculto -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">{preheader}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{COLOR_SURFACE_SOFT};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,{COLOR_PRIMARY},{COLOR_PRIMARY_LIGHT});
                       border-radius:28px 28px 0 0;padding:32px 32px 28px;text-align:center;">
              <img src="{LOGO_URL}" alt="{PLATFORM_NAME}" width="48" height="48"
                   style="border-radius:14px;background:#ffffff;padding:4px;display:inline-block;margin-bottom:10px;" />
              <div style="color:#ffffff;font-size:18px;font-weight:800;letter-spacing:-0.3px;">{PLATFORM_NAME}</div>
            </td>
          </tr>

          <!-- Card -->
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

          <!-- Footer -->
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


def _send(to_email: str, subject: str, html: str) -> bool:
    try:
        resend.Emails.send({
            "from": settings.EMAIL_FROM,
            "to": to_email,
            "subject": subject,
            "html": html,
        })
        return True
    except Exception as e:
        logger.error(f"Error enviando email a {to_email} ({subject}): {e}")
        return False


# ─── Autenticación ────────────────────────────────────────────────────────────

def send_password_reset_email(to_email: str, user_name: str, reset_token: str) -> bool:
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={reset_token}"
    body = f"""
      <p>Hola {user_name},</p>
      <p>Recibimos una solicitud para restablecer tu contraseña. Este enlace expira en 1 hora.
      Si no fuiste tú, puedes ignorar este correo con total tranquilidad.</p>
      {_cta_button("Restablecer contraseña", reset_url)}
    """
    html = _base_template(
        preheader="Restablece tu contraseña",
        badge_html=_badge("Seguridad", COLOR_BLUE),
        heading="Recuperar contraseña",
        body_html=body,
    )
    return _send(to_email, f"Restablecer contraseña — {PLATFORM_NAME}", html)


def send_username_recovery_email(to_email: str, user_name: str, username: str) -> bool:
    body = f"""
      <p>Hola {user_name},</p>
      <p>Recibimos una solicitud para recordarte tu nombre de usuario para acceder a la plataforma.</p>
      <div style="background:{COLOR_SURFACE_SOFT};border-radius:16px;padding:18px;margin:20px 0;text-align:center;">
        <p style="margin:0;font-size:12px;color:{COLOR_MUTED};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Tu nombre de usuario</p>
        <p style="margin:8px 0 0;font-size:22px;font-weight:800;color:{COLOR_PRIMARY};letter-spacing:-0.3px;">{username}</p>
      </div>
      <p>Si no fuiste tú, puedes ignorar este correo con total tranquilidad.</p>
    """
    html = _base_template(
        preheader="Recuperación de nombre de usuario",
        badge_html=_badge("Seguridad", COLOR_BLUE),
        heading="Tu nombre de usuario 👤",
        body_html=body,
    )
    return _send(to_email, f"Recuperación de usuario — {PLATFORM_NAME}", html)


# ─── Reservas / clases (ESTUDIANTE) ──────────────────────────────────────────

def send_class_booking_confirmation(
    to_email: str, student_name: str, teacher_name: str, subject: str,
    class_start_utc: str, duration_minutes: int,
) -> bool:
    body = f"""
      <p>Hola {student_name},</p>
      <p>Tu reserva ha sido registrada. Recuerda subir el comprobante de pago para confirmarla.</p>
      {_detail_table([
        _detail_row("Profesor", teacher_name),
        _detail_row("Materia", subject),
        _detail_row("Fecha/Hora (UTC)", class_start_utc),
        _detail_row("Duración", f"{duration_minutes} minutos"),
      ])}
      <p>Una vez el staff verifique tu pago recibirás el link de Google Meet.</p>
    """
    html = _base_template(
        preheader="Tu reserva fue registrada",
        badge_html=_badge("Reserva recibida", COLOR_AMBER),
        heading="Reserva recibida 📅",
        body_html=body,
    )
    return _send(to_email, f"Reserva recibida — {PLATFORM_NAME}", html)


def send_class_confirmed_email(
    to_email: str, student_name: str, teacher_name: str, subject: str,
    class_start_utc: str, duration_minutes: int, meet_link: str,
) -> bool:
    body = f"""
      <p>Hola {student_name}, tu pago fue verificado. ¡Ya tienes tu clase confirmada!</p>
      {_detail_table([
        _detail_row("Profesor", teacher_name),
        _detail_row("Materia", subject),
        _detail_row("Fecha/Hora (UTC)", class_start_utc),
        _detail_row("Duración", f"{duration_minutes} minutos"),
      ])}
      {_cta_button("Unirme a la clase", meet_link)}
      <p style="font-size:12px;color:{COLOR_SUBTLE};">Guarda este correo — el enlace lo necesitarás el día de la clase.</p>
    """
    html = _base_template(
        preheader="Tu clase fue confirmada",
        badge_html=_badge("Confirmada", COLOR_GREEN),
        heading="Clase confirmada ✅",
        body_html=body,
    )
    return _send(to_email, f"Clase confirmada — {PLATFORM_NAME}", html)


def send_class_reminder_email(
    to_email: str, student_name: str, teacher_name: str,
    class_start_utc: str, meet_link: str, hours_before: int = 24,
) -> bool:
    body = f"""
      <p>Hola {student_name},</p>
      <p>Tu clase con <strong style="color:{COLOR_INK};">{teacher_name}</strong> es en
      <strong style="color:{COLOR_PRIMARY};">{hours_before} horas</strong>.</p>
      {_detail_table([_detail_row("Fecha/Hora (UTC)", class_start_utc)])}
      {_cta_button("Unirme a la clase", meet_link) if meet_link else ""}
    """
    html = _base_template(
        preheader=f"Tu clase es en {hours_before} horas",
        badge_html=_badge("Recordatorio", COLOR_BLUE),
        heading="Recordatorio de clase 🔔",
        body_html=body,
    )
    return _send(to_email, f"Recordatorio: clase en {hours_before}h — {PLATFORM_NAME}", html)


def send_class_cancelled_email(
    to_email: str, student_name: str, class_start_utc: str, cancelled_by: str,
) -> bool:
    reason = "cancelaste tu clase" if cancelled_by == "student" else "tu clase fue cancelada"
    body = f"""
      <p>Hola {student_name}, {reason}.</p>
      {_detail_table([_detail_row("Fecha/Hora (UTC)", class_start_utc)])}
      <p>Si tienes dudas, contacta al staff o a tu profesor(a).</p>
    """
    html = _base_template(
        preheader="Tu clase fue cancelada",
        badge_html=_badge("Cancelada", COLOR_RED),
        heading="Clase cancelada ❌",
        body_html=body,
    )
    return _send(to_email, f"Clase cancelada — {PLATFORM_NAME}", html)


# ─── Reservas / clases (PROFESOR) — NUEVO ────────────────────────────────────

def send_new_booking_teacher_email(
    to_email: str, teacher_name: str, student_name: str, subject: str,
    class_start_utc: str, duration_minutes: int, is_trial: bool = False,
) -> bool:
    body = f"""
      <p>Hola {teacher_name}, tienes una nueva {"clase de prueba" if is_trial else "clase"} reservada.</p>
      {_detail_table([
        _detail_row("Estudiante", student_name),
        _detail_row("Materia", subject),
        _detail_row("Fecha/Hora (UTC)", class_start_utc),
        _detail_row("Duración", f"{duration_minutes} minutos"),
      ])}
      <p>{"El staff confirmará la clase de prueba en breve." if is_trial else "La clase quedará confirmada una vez se valide el pago del estudiante."}</p>
    """
    html = _base_template(
        preheader="Nueva clase reservada",
        badge_html=_badge("Prueba" if is_trial else "Nueva reserva", COLOR_BLUE if is_trial else COLOR_AMBER),
        heading="Nueva clase reservada 📥",
        body_html=body,
    )
    return _send(to_email, f"Nueva reserva — {PLATFORM_NAME}", html)


def send_class_confirmed_teacher_email(
    to_email: str, teacher_name: str, student_name: str, subject: str,
    class_start_utc: str, duration_minutes: int, meet_link: str,
) -> bool:
    body = f"""
      <p>Hola {teacher_name}, el pago de <strong style="color:{COLOR_INK};">{student_name}</strong> fue verificado. La clase queda confirmada.</p>
      {_detail_table([
        _detail_row("Estudiante", student_name),
        _detail_row("Materia", subject),
        _detail_row("Fecha/Hora (UTC)", class_start_utc),
        _detail_row("Duración", f"{duration_minutes} minutos"),
      ])}
      {_cta_button("Ver enlace de Meet", meet_link)}
    """
    html = _base_template(
        preheader="Clase confirmada",
        badge_html=_badge("Confirmada", COLOR_GREEN),
        heading="Clase confirmada ✅",
        body_html=body,
    )
    return _send(to_email, f"Clase confirmada — {PLATFORM_NAME}", html)


def send_class_reminder_teacher_email(
    to_email: str, teacher_name: str, student_name: str,
    class_start_utc: str, meet_link: str, hours_before: int = 24,
) -> bool:
    body = f"""
      <p>Hola {teacher_name},</p>
      <p>Tu clase con <strong style="color:{COLOR_INK};">{student_name}</strong> es en
      <strong style="color:{COLOR_PRIMARY};">{hours_before} horas</strong>.</p>
      {_detail_table([_detail_row("Fecha/Hora (UTC)", class_start_utc)])}
      {_cta_button("Unirme a la clase", meet_link) if meet_link else ""}
    """
    html = _base_template(
        preheader=f"Tu clase es en {hours_before} horas",
        badge_html=_badge("Recordatorio", COLOR_BLUE),
        heading="Recordatorio de clase 🔔",
        body_html=body,
    )
    return _send(to_email, f"Recordatorio: clase en {hours_before}h — {PLATFORM_NAME}", html)


def send_class_cancelled_teacher_email(
    to_email: str, teacher_name: str, student_name: str, class_start_utc: str, cancelled_by: str,
) -> bool:
    reason = f"{student_name} canceló su clase" if cancelled_by == "student" else "cancelaste esta clase"
    body = f"""
      <p>Hola {teacher_name}, {reason}.</p>
      {_detail_table([
        _detail_row("Estudiante", student_name),
        _detail_row("Fecha/Hora (UTC)", class_start_utc),
      ])}
    """
    html = _base_template(
        preheader="Una clase fue cancelada",
        badge_html=_badge("Cancelada", COLOR_RED),
        heading="Clase cancelada ❌",
        body_html=body,
    )
    return _send(to_email, f"Clase cancelada — {PLATFORM_NAME}", html)


# ─── Tareas — NUEVO ───────────────────────────────────────────────────────────

def send_homework_graded_email(
    to_email: str, student_name: str, homework_title: str, score: float, feedback: str | None,
) -> bool:
    score_color = COLOR_GREEN if score >= 8 else (COLOR_AMBER if score >= 6 else COLOR_RED)
    body = f"""
      <p>Hola {student_name}, tu profesor(a) calificó tu tarea <strong style="color:{COLOR_INK};">"{homework_title}"</strong>.</p>
      <div style="text-align:center;margin:22px 0;">
        <span style="display:inline-block;font-size:32px;font-weight:900;color:{score_color};">{score}<span style="font-size:16px;color:{COLOR_SUBTLE};">/10</span></span>
      </div>
      {f'<div style="background:{COLOR_SURFACE_SOFT};border-radius:16px;padding:16px 18px;margin-top:8px;"><p style="margin:0;font-size:13px;color:{COLOR_INK};"><strong>Retroalimentación:</strong> {feedback}</p></div>' if feedback else ''}
    """
    html = _base_template(
        preheader="Tu tarea fue calificada",
        badge_html=_badge("Tarea calificada", COLOR_GREEN),
        heading="¡Tienes una nueva calificación! ⭐",
        body_html=body,
    )
    return _send(to_email, f"Tarea calificada — {PLATFORM_NAME}", html)


# ─── Materiales — NUEVO ───────────────────────────────────────────────────────

def send_material_assigned_email(
    to_email: str, student_name: str, teacher_name: str, material_title: str, category: str,
) -> bool:
    body = f"""
      <p>Hola {student_name}, <strong style="color:{COLOR_INK};">{teacher_name}</strong> te asignó un nuevo material de estudio.</p>
      {_detail_table([
        _detail_row("Material", material_title),
        _detail_row("Categoría", category),
      ])}
      <p>Entra a tu panel de materiales para revisarlo.</p>
    """
    html = _base_template(
        preheader="Nuevo material asignado",
        badge_html=_badge("Nuevo material", COLOR_BLUE),
        heading="Nuevo material asignado 📚",
        body_html=body,
    )
    return _send(to_email, f"Nuevo material asignado — {PLATFORM_NAME}", html)