"""Fase 20 (dinero): columnas de dinero a NUMERIC(12,2), CHECK saldo >= 0 y tabla manual_grant_requests

Revision ID: f20a1b2c3d4e
Revises: e6c3d4e5f6a7
Create Date: 2026-11-21 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'f20a1b2c3d4e'
down_revision = 'e6c3d4e5f6a7'
branch_labels = None
depends_on = None

# (tabla, columna, nullable)
MONEY_COLUMNS = [
    ('payments', 'amount_total', False),
    ('payments', 'amount_teacher', False),
    ('payments', 'amount_platform', False),
    ('teacher_wallets', 'available_balance', True),
    ('teacher_wallets', 'total_earned', True),
    ('teacher_wallets', 'total_withdrawn', True),
    ('withdrawals', 'amount', False),
    ('packages', 'price', False),
    ('packages', 'price_per_class', True),
    ('packages', 'installment_amount', True),
    ('enrollments', 'credit_balance_usd', True),
    ('teacher_profiles', 'balance', True),
]


def upgrade():
    # Datos sanos antes de poner el CHECK: ni NaN ni negativos en el saldo disponible.
    op.execute("UPDATE teacher_wallets SET available_balance = 0 "
               "WHERE available_balance IS NOT NULL AND (available_balance < 0 OR available_balance = 'NaN')")
    op.execute("UPDATE teacher_wallets SET total_earned = 0 WHERE total_earned = 'NaN'")
    op.execute("UPDATE teacher_wallets SET total_withdrawn = 0 WHERE total_withdrawn = 'NaN'")

    for table, column, nullable in MONEY_COLUMNS:
        op.alter_column(
            table, column,
            existing_type=sa.Float(), type_=sa.Numeric(12, 2), existing_nullable=nullable,
            postgresql_using=f'round("{column}"::numeric, 2)',
        )

    op.create_check_constraint(
        'ck_teacher_wallets_balance_nonneg', 'teacher_wallets', 'available_balance >= 0',
    )

    op.create_table(
        'manual_grant_requests',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('teacher_id', sa.Integer(), nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('enrollment_id', sa.Integer(), nullable=False),
        sa.Column('package_id', sa.Integer(), nullable=True),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('status', sa.String(), server_default='pending', nullable=False),
        sa.Column('rejection_reason', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolved_by', sa.Integer(), nullable=True),
        sa.Column('payment_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['teacher_id'], ['teacher_profiles.id']),
        sa.ForeignKeyConstraint(['student_id'], ['student_profiles.id']),
        sa.ForeignKeyConstraint(['enrollment_id'], ['enrollments.id']),
        sa.ForeignKeyConstraint(['package_id'], ['packages.id']),
        sa.ForeignKeyConstraint(['payment_id'], ['payments.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_manual_grant_requests_id', 'manual_grant_requests', ['id'])
    op.create_index('ix_manual_grant_requests_teacher_id', 'manual_grant_requests', ['teacher_id'])
    op.create_index('ix_manual_grant_requests_enrollment_id', 'manual_grant_requests', ['enrollment_id'])
    op.create_index('ix_manual_grant_requests_status', 'manual_grant_requests', ['status'])


def downgrade():
    op.drop_table('manual_grant_requests')
    op.drop_constraint('ck_teacher_wallets_balance_nonneg', 'teacher_wallets', type_='check')
    for table, column, nullable in reversed(MONEY_COLUMNS):
        op.alter_column(
            table, column,
            existing_type=sa.Numeric(12, 2), type_=sa.Float(), existing_nullable=nullable,
            postgresql_using=f'"{column}"::double precision',
        )
