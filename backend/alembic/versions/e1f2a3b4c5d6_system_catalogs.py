"""system catalogs and configurable business rules

Revision ID: e1f2a3b4c5d6
Revises: c3d4e5f6a7b8
Create Date: 2026-08-22 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'e1f2a3b4c5d6'
down_revision = 'c3d4e5f6a7b8'
branch_labels = None
depends_on = None


DEFAULT_CATALOGS = [
    {
        "key": "subjects", "label": "Materias",
        "value": ["Matematica", "Lenguaje", "Física", "Musica", "Quimica", "Historia",
                  "Arte", "Programación", "Ciencias", "Economía", "Psicología", "Negocios"],
    },
    {
        "key": "languages", "label": "Idiomas",
        "value": ["Español", "Ingles", "Frances", "Italiano", "Portugues", "Aleman"],
    },
    {
        "key": "skill_suggestions", "label": "Habilidades sugeridas",
        "value": ["Gramática", "Conversación", "Pronunciación", "Vocabulario",
                   "Business English", "IELTS", "TOEFL", "Niños", "Viajes", "Redacción"],
    },
    {
        "key": "student_goals", "label": "Objetivos de aprendizaje",
        "value": [
            {"text": "Conversaciones cotidianas", "desc": "Hablar de temas del día a día", "icon": "🗣️"},
            {"text": "Mejorar pronunciación", "desc": "Fluidez y acento natural", "icon": "🎙️"},
            {"text": "Ampliar vocabulario", "desc": "Palabras para situaciones reales", "icon": "📚"},
            {"text": "Comprender audios/videos", "desc": "Entender a hablantes nativos", "icon": "🎧"},
            {"text": "Preparar exámenes", "desc": "TOEFL, IELTS, Cambridge, etc.", "icon": "📝"},
            {"text": "Viajar al extranjero", "desc": "Sobrevivir en otro país en inglés", "icon": "✈️"},
        ],
    },
    {
        "key": "student_payment_methods", "label": "Métodos de pago preferidos (estudiante)",
        "value": [
            {"value": "Paypal", "label": "PayPal", "icon": "💳"},
            {"value": "Binance", "label": "Binance (USDT)", "icon": "🔶"},
            {"value": "Zelle", "label": "Zelle", "icon": "💜"},
            {"value": "BankTransfer", "label": "Transferencia bancaria", "icon": "🏦"},
            {"value": "MobilePayment", "label": "Pago móvil/Bizum", "icon": "📱"},
        ],
    },
    {
        "key": "withdrawal_methods", "label": "Métodos de retiro (profesor)",
        "value": [
            {"value": "paypal", "label": "PayPal", "icon": "🅿️"},
            {"value": "binance", "label": "Binance (USDT)", "icon": "🔸"},
            {"value": "bank", "label": "Transferencia", "icon": "🏦"},
        ],
    },
    {
        "key": "material_categories", "label": "Categorías de materiales",
        "value": ["Grammar", "Reading", "Exercises", "Vocabulary"],
    },
    {
        "key": "material_levels", "label": "Niveles de materiales",
        "value": ["A1", "A2", "B1", "B2", "C1", "C2"],
    },
    {
        "key": "theme_presets", "label": "Colores de tema (perfil/paquetes)",
        "value": [
            {"label": "Rosa", "value": "#ec4899"}, {"label": "Rojo", "value": "#ef4444"},
            {"label": "Naranja", "value": "#f97316"}, {"label": "Ámbar", "value": "#f59e0b"},
            {"label": "Esmeralda", "value": "#10b981"}, {"label": "Azul", "value": "#3b82f6"},
            {"label": "Índigo", "value": "#6366f1"}, {"label": "Violeta", "value": "#8b5cf6"},
            {"label": "Slate", "value": "#475569"},
        ],
    },
    {
        "key": "package_icon_options", "label": "Iconos disponibles para paquetes",
        "value": ["📦", "📚", "🎓", "✏️", "🗣️", "🎯", "⭐", "🚀", "💡", "🧩",
                   "🔢", "📖", "⚛️", "🎵", "🧪", "🏛️", "🎨", "💻", "🔬", "📈",
                   "🧠", "💼", "🇪🇸", "🇬🇧", "🇫🇷", "🇮🇹", "🇵🇹", "🇩🇪", "🌍", "📝"],
    },
    {
        "key": "subject_theme_map", "label": "Tema sugerido por materia/idioma",
        "value": {
            "Matematica": {"icon": "🔢", "color": "#3b82f6"}, "Lenguaje": {"icon": "📖", "color": "#8b5cf6"},
            "Física": {"icon": "⚛️", "color": "#6366f1"}, "Musica": {"icon": "🎵", "color": "#f59e0b"},
            "Quimica": {"icon": "🧪", "color": "#10b981"}, "Historia": {"icon": "🏛️", "color": "#92400e"},
            "Arte": {"icon": "🎨", "color": "#ec4899"}, "Programación": {"icon": "💻", "color": "#475569"},
            "Ciencias": {"icon": "🔬", "color": "#059669"}, "Economía": {"icon": "📈", "color": "#0891b2"},
            "Psicología": {"icon": "🧠", "color": "#a855f7"}, "Negocios": {"icon": "💼", "color": "#1d4ed8"},
            "Español": {"icon": "🇪🇸", "color": "#ef4444"}, "Ingles": {"icon": "🇬🇧", "color": "#2563eb"},
            "Frances": {"icon": "🇫🇷", "color": "#3b82f6"}, "Italiano": {"icon": "🇮🇹", "color": "#16a34a"},
            "Portugues": {"icon": "🇵🇹", "color": "#16a34a"}, "Aleman": {"icon": "🇩🇪", "color": "#f59e0b"},
        },
    },
]


def upgrade() -> None:
    op.create_table(
        'system_catalogs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(), nullable=False),
        sa.Column('label', sa.String(), nullable=False),
        sa.Column('value', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('key'),
    )
    op.create_index(op.f('ix_system_catalogs_key'), 'system_catalogs', ['key'], unique=True)
    op.create_index(op.f('ix_system_catalogs_id'), 'system_catalogs', ['id'], unique=False)

    op.add_column('platform_config', sa.Column('min_booking_hours', sa.Integer(), server_default='1', nullable=True))
    op.add_column('platform_config', sa.Column('min_cancel_hours', sa.Integer(), server_default='12', nullable=True))
    op.add_column('platform_config', sa.Column('min_reschedule_hours_student', sa.Integer(), server_default='12', nullable=True))
    op.add_column('platform_config', sa.Column('allowed_class_durations', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('platform_config', sa.Column('allowed_package_durations', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('platform_config', sa.Column('low_credit_threshold', sa.Integer(), server_default='1', nullable=True))
    op.add_column('platform_config', sa.Column('low_credit_renotify_days', sa.Integer(), server_default='6', nullable=True))

    conn = op.get_bind()
    catalogs_table = sa.table(
        'system_catalogs',
        sa.column('key', sa.String), sa.column('label', sa.String), sa.column('value', postgresql.JSONB),
    )
    for c in DEFAULT_CATALOGS:
        conn.execute(catalogs_table.insert().values(key=c["key"], label=c["label"], value=c["value"]))

    conn.execute(sa.text(
        "UPDATE platform_config SET allowed_class_durations = '[30,60]'::jsonb, "
        "allowed_package_durations = '[30,60]'::jsonb WHERE allowed_class_durations IS NULL"
    ))


def downgrade() -> None:
    op.drop_column('platform_config', 'low_credit_renotify_days')
    op.drop_column('platform_config', 'low_credit_threshold')
    op.drop_column('platform_config', 'allowed_package_durations')
    op.drop_column('platform_config', 'allowed_class_durations')
    op.drop_column('platform_config', 'min_reschedule_hours_student')
    op.drop_column('platform_config', 'min_cancel_hours')
    op.drop_column('platform_config', 'min_booking_hours')
    op.drop_index(op.f('ix_system_catalogs_id'), table_name='system_catalogs')
    op.drop_index(op.f('ix_system_catalogs_key'), table_name='system_catalogs')
    op.drop_table('system_catalogs')