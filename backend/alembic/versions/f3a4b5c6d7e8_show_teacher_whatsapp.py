"""agrega show_teacher_whatsapp a platform_config

Interruptor global para que el superadmin pueda ocultar el botón de
WhatsApp que cada profesor puede cargar en su propio perfil
(TeacherProfile.social_links.whatsapp), sin tener que pedirle a cada
profesor que borre su número. Default True para no cambiar el
comportamiento actual de nadie al aplicar la migración.

Revision ID: f3a4b5c6d7e8
Revises: 8954d8b9d779
Create Date: 2026-09-10 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'f3a4b5c6d7e8'
down_revision = '8954d8b9d779'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'platform_config',
        sa.Column('show_teacher_whatsapp', sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade():
    op.drop_column('platform_config', 'show_teacher_whatsapp')
