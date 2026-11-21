"""Correos de las solicitudes de otorgamiento manual (Fase 20, D5).

Usan las mismas plantillas/categorias que el resto (core/email.py no se toca): el aviso al staff va en la
categoria `admin_payments` y la respuesta al profesor en `receipts`, asi los interruptores de /admin/settings
los controlan igual que a los demas correos de dinero.
"""
from html import escape

from app.core.config import settings
from app.core.email import (
    COLOR_AMBER, COLOR_GREEN, COLOR_RED, PLATFORM_NAME,
    _badge, _base_template, _cta_button, _detail_row, _detail_table, _send,
)


def send_admin_manual_grant_requested_email(
    to_email: str, teacher_name: str, student_name: str, package_name: str, reason: str,
) -> bool:
    body = f"""
      <p>Un profesor pide darle un paquete gratis a un alumno.</p>
      {_detail_table([
        _detail_row("Profesor", escape(teacher_name)),
        _detail_row("Alumno", escape(student_name)),
        _detail_row("Paquete", escape(package_name)),
        _detail_row("Motivo", escape(reason)),
      ])}
      {_cta_button("Revisar solicitud", f"{settings.FRONTEND_URL}/admin/payments")}
    """
    html = _base_template("Solicitud de paquete gratis", _badge("Pendiente", COLOR_AMBER), "Solicitud de paquete gratis", body)
    return _send(to_email, f"Solicitud de paquete gratis — {PLATFORM_NAME}", html, category="admin_payments")


def send_manual_grant_resolved_email(
    to_email: str, teacher_name: str, student_name: str, approved: bool, rejection_reason: str | None = None,
) -> bool:
    label = "Aprobada" if approved else "Rechazada"
    color = COLOR_GREEN if approved else COLOR_RED
    reason_html = (
        f'<p style="font-size:13px;color:{COLOR_RED};font-weight:700;white-space:pre-wrap;">Motivo: {escape(rejection_reason)}</p>'
        if not approved and rejection_reason else ""
    )
    body = f"""
      <p>Hola {escape(teacher_name)}, tu solicitud de paquete gratis para {escape(student_name)} fue {label.lower()}.</p>
      {reason_html}
      {_cta_button("Ver mis alumnos", f"{settings.FRONTEND_URL}/teacher/packages")}
    """
    html = _base_template("Solicitud de paquete gratis", _badge(label, color), f"Solicitud {label.lower()}", body)
    return _send(to_email, f"Solicitud de paquete gratis {label.lower()} — {PLATFORM_NAME}", html, category="receipts")
