"""agrega refund_payment_info a payments

Datos de destino que el estudiante completa en el modal de "Solicitar
reembolso" (M2 del roadmap de verificación): a qué cuenta/medio quiere
que se le devuelva el dinero. Todos los sub-campos son opcionales (ver
schemas.payments.RefundPaymentInfo) — el alumno llena el/los que tenga,
o deja solo una nota de texto libre si no tiene ninguno de los métodos
predefinidos. Solo se usa cuando payment_type == "refund"; None en el
resto de los pagos.

Revision ID: a2b3c4d5e6f7
Revises: 9f1a2b3c4d5e
Create Date: 2026-09-12 00:00:00.000001
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'a2b3c4d5e6f7'
down_revision = '9f1a2b3c4d5e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'payments',
        sa.Column('refund_payment_info', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('payments', 'refund_payment_info')
