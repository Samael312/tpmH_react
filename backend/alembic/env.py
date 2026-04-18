import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context
from dotenv import load_dotenv
from app.core.config import settings

# 1. Importar la Base y todos los modelos

from app.db.base import Base 
from app.models import * # 2. Cargar variables de entorno
load_dotenv()

config = context.config

# 3. Configurar la URL de la base de datos dinámicamente
database_url = os.getenv("DATABASE_URL")
if database_url and database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql://", 1)

config.set_main_option("sqlalchemy.url", database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# 4. Asignar el metadata para autogenerate
target_metadata = Base.metadata

def run_migrations_offline() -> None:
    """Modo offline: genera scripts SQL sin conectarse físicamente."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    """Modo online: se conecta a la DB y aplica cambios."""
    # Usamos la configuración que ya tiene la URL inyectada
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, 
            target_metadata=target_metadata,
            # Esto ayuda a detectar cambios de tipos y nombres de columnas
            compare_type=True, 
        )

        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()