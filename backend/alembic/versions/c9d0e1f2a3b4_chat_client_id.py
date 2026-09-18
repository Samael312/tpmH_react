"""chat: client_id en chat_messages (envío idempotente)

Agrega chat_messages.client_id (uuid generado por el cliente) y un único
(conversation_id, sender_id, client_id). Permite que el frontend reintente
por REST un mensaje cuyo eco por WS no llegó sin duplicarlo. Los NULL no
chocan entre sí en el índice único, así que los mensajes existentes no
se ven afectados.

Revision ID: c9d0e1f2a3b4
Revises: b7c8d9e0f1a2
Create Date: 2026-09-18 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'c9d0e1f2a3b4'
down_revision = 'b7c8d9e0f1a2'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('chat_messages', sa.Column('client_id', sa.String(length=64), nullable=True))
    op.create_unique_constraint(
        'uq_chat_message_client_id', 'chat_messages',
        ['conversation_id', 'sender_id', 'client_id'],
    )


def downgrade():
    op.drop_constraint('uq_chat_message_client_id', 'chat_messages', type_='unique')
    op.drop_column('chat_messages', 'client_id')
