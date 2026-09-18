"""chat: delivered_at en chat_messages (checkmarks + WS global por usuario)

Agrega chat_messages.delivered_at, usado por el nuevo endpoint WS global
(core/chat_ws.py) para marcar cuándo un mensaje le llegó a al menos un
destinatario conectado — habilita el segundo checkmark en el frontend.

Revision ID: b7c8d9e0f1a2
Revises: a1c2h3a4t5b6
Create Date: 2026-09-18 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b7c8d9e0f1a2'
down_revision = 'a1c2h3a4t5b6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'chat_messages',
        sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column('chat_messages', 'delivered_at')
