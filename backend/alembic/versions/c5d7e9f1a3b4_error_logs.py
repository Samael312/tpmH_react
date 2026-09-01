"""error logs

Crea la tabla error_logs, usada por la pantalla de Logs de /admin para
centralizar errores de backend (excepciones no controladas + errores de
negocio relevantes en pagos/clases/cohortes/paquetes) y de frontend
(crashes de React no controlados + fallos de llamadas a la API).

Revision ID: c5d7e9f1a3b4
Revises: b2c4d6e8f0a1
Create Date: 2026-09-01 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'c5d7e9f1a3b4'
down_revision = 'b2c4d6e8f0a1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'error_logs',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('source', sa.String(), nullable=False),
        sa.Column('level', sa.String(), nullable=False, server_default='error'),
        sa.Column('message', sa.String(), nullable=False),
        sa.Column('detail', sa.Text(), nullable=True),
        sa.Column('screen', sa.String(), nullable=True),
        sa.Column('method', sa.String(), nullable=True),
        sa.Column('status_code', sa.Integer(), nullable=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('user_name', sa.String(), nullable=True),
        sa.Column('user_role', sa.String(), nullable=True),
        sa.Column('extra_data', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_error_logs_source', 'error_logs', ['source'])
    op.create_index('ix_error_logs_level', 'error_logs', ['level'])
    op.create_index('ix_error_logs_screen', 'error_logs', ['screen'])
    op.create_index('ix_error_logs_user_id', 'error_logs', ['user_id'])
    op.create_index('ix_error_logs_created_at', 'error_logs', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_error_logs_created_at', table_name='error_logs')
    op.drop_index('ix_error_logs_user_id', table_name='error_logs')
    op.drop_index('ix_error_logs_screen', table_name='error_logs')
    op.drop_index('ix_error_logs_level', table_name='error_logs')
    op.drop_index('ix_error_logs_source', table_name='error_logs')
    op.drop_table('error_logs')
