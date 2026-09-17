"""chat interno (N1) + toggle/retención/reactivación en platform_config (N2)

Agrega:
  - chat_conversations (direct 1:1 sobre StudentTeacherLink, o group 1 por
    GroupCohort)
  - chat_messages
  - chat_read_states (last_read_at por usuario, necesario para grupos)
  - platform_config.chat_enabled / chat_retention_days / chat_reactivation_hours

Revision ID: a1c2h3a4t5b6
Revises: b2c4e6a8d1f3
Create Date: 2026-09-16 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'a1c2h3a4t5b6'
down_revision = 'b2c4e6a8d1f3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'platform_config',
        sa.Column('chat_enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        'platform_config',
        sa.Column('chat_retention_days', sa.Integer(), nullable=False, server_default='90'),
    )
    op.add_column(
        'platform_config',
        sa.Column('chat_reactivation_hours', sa.Integer(), nullable=False, server_default='24'),
    )

    conversation_type_enum = postgresql.ENUM('direct', 'group', name='chatconversationtype')
    conversation_type_enum.create(op.get_bind(), checkfirst=True)
    # create_type=False: el tipo ya lo creamos arriba a mano. OJO: sa.Enum
    # (genérico) con create_type=False NO propaga el flag al dialect impl
    # de Postgres en esta versión de SQLAlchemy (confirmado con un repro
    # standalone: dialect_impl() devuelve create_type=True igual) — por
    # eso acá se usa postgresql.ENUM directamente, que sí lo respeta.
    conversation_type_col = postgresql.ENUM(
        'direct', 'group', name='chatconversationtype', create_type=False,
    )

    op.create_table(
        'chat_conversations',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('conversation_type', conversation_type_col, nullable=False),
        sa.Column('teacher_id', sa.Integer(), sa.ForeignKey('teacher_profiles.id'), nullable=False),
        sa.Column('student_id', sa.Integer(), sa.ForeignKey('student_profiles.id'), nullable=True),
        sa.Column('cohort_id', sa.Integer(), sa.ForeignKey('group_cohorts.id'), nullable=True, unique=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('last_message_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_message_preview', sa.String(), nullable=True),
        sa.Column('teacher_last_notified_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('teacher_id', 'student_id', name='uq_chat_direct_conversation'),
    )
    op.create_index(
        'ix_chat_conversations_last_message_at', 'chat_conversations', ['last_message_at'],
    )

    op.create_table(
        'chat_messages',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column(
            'conversation_id', sa.Integer(),
            sa.ForeignKey('chat_conversations.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('sender_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        'ix_chat_messages_conversation_created', 'chat_messages', ['conversation_id', 'created_at'],
    )

    op.create_table(
        'chat_read_states',
        sa.Column(
            'conversation_id', sa.Integer(),
            sa.ForeignKey('chat_conversations.id', ondelete='CASCADE'), primary_key=True,
        ),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), primary_key=True),
        sa.Column('last_read_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_table('chat_read_states')
    op.drop_index('ix_chat_messages_conversation_created', table_name='chat_messages')
    op.drop_table('chat_messages')
    op.drop_index('ix_chat_conversations_last_message_at', table_name='chat_conversations')
    op.drop_table('chat_conversations')

    conversation_type_enum = postgresql.ENUM('direct', 'group', name='chatconversationtype')
    conversation_type_enum.drop(op.get_bind(), checkfirst=True)

    op.drop_column('platform_config', 'chat_reactivation_hours')
    op.drop_column('platform_config', 'chat_retention_days')
    op.drop_column('platform_config', 'chat_enabled')
