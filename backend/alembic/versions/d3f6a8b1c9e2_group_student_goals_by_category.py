"""group student_goals catalog by category (idiomas / academico)

La plataforma no es solo de idiomas: los objetivos sugeridos en el
onboarding del estudiante eran 100% de idioma (TOEFL, IELTS, viajar
al extranjero, pronunciación, etc.) aunque ya existen materias como
Matemática, Física, Programación, Música, etc.

Esta migración reestructura el catálogo `student_goals` de una lista
plana a un dict agrupado por categoría:

    {
      "idiomas":   [ {text, desc, icon}, ... ],
      "academico": [ {text, desc, icon}, ... ],
    }

El frontend usa la categoría elegida por el estudiante (idiomas vs.
otras materias) para mostrar el set de sugerencias correcto. El
downgrade aplana de nuevo a la lista original (solo idiomas) para
poder revertir sin perder datos si el admin no ha tocado el catálogo.

Revision ID: d3f6a8b1c9e2
Revises: c9a1d5e3f7b2
Create Date: 2026-08-30 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'd3f6a8b1c9e2'
down_revision = 'c9a1d5e3f7b2'
branch_labels = None
depends_on = None


OLD_LANGUAGE_GOALS = [
    {"text": "Conversaciones cotidianas", "desc": "Hablar de temas del día a día", "icon": "🗣️"},
    {"text": "Mejorar pronunciación", "desc": "Fluidez y acento natural", "icon": "🎙️"},
    {"text": "Ampliar vocabulario", "desc": "Palabras para situaciones reales", "icon": "📚"},
    {"text": "Comprender audios/videos", "desc": "Entender a hablantes nativos", "icon": "🎧"},
    {"text": "Preparar exámenes", "desc": "TOEFL, IELTS, Cambridge, etc.", "icon": "📝"},
    {"text": "Viajar al extranjero", "desc": "Comunicarme sin problemas en otro país", "icon": "✈️"},
]

NEW_ACADEMIC_GOALS = [
    {"text": "Reforzar lo que veo en clase", "desc": "Entender mejor los temas de mi curso", "icon": "📘"},
    {"text": "Ponerme al día", "desc": "Recuperar contenido atrasado", "icon": "⏱️"},
    {"text": "Preparar un examen", "desc": "Estudiar para una evaluación o admisión", "icon": "📝"},
    {"text": "Resolver dudas puntuales", "desc": "Ayuda con tareas o ejercicios específicos", "icon": "❓"},
    {"text": "Aprender desde cero", "desc": "Empezar sin conocimientos previos", "icon": "🌱"},
    {"text": "Prepararme para una competencia", "desc": "Olimpiadas, concursos u otros retos", "icon": "🏆"},
]

NEW_GROUPED_VALUE = {
    "idiomas": OLD_LANGUAGE_GOALS,
    "academico": NEW_ACADEMIC_GOALS,
}


def upgrade() -> None:
    conn = op.get_bind()
    catalogs_table = sa.table(
        'system_catalogs',
        sa.column('key', sa.String), sa.column('value', postgresql.JSONB),
    )
    conn.execute(
        catalogs_table.update()
        .where(catalogs_table.c.key == 'student_goals')
        .values(value=NEW_GROUPED_VALUE)
    )


def downgrade() -> None:
    conn = op.get_bind()
    catalogs_table = sa.table(
        'system_catalogs',
        sa.column('key', sa.String), sa.column('value', postgresql.JSONB),
    )
    conn.execute(
        catalogs_table.update()
        .where(catalogs_table.c.key == 'student_goals')
        .values(value=OLD_LANGUAGE_GOALS)
    )
