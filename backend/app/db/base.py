from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from sqlalchemy.pool import NullPool
import os
from dotenv import load_dotenv

load_dotenv(override=True)

DATABASE_URL = os.getenv("DATABASE_URL")

engine = create_engine(
    DATABASE_URL,
    poolclass=NullPool,  # Importante para Neon (serverless)
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

# Engine dedicado al camino caliente del chat (envío de mensajes por WS/REST).
# Con NullPool cada commit() cierra la conexión física y la siguiente query
# abre otra contra Neon (TCP + TLS + auth): un solo envío de mensaje hacía
# 3-4 reconexiones, y de ahí los segundos en "enviándose". Acá se reutilizan
# conexiones; pool_pre_ping y pool_recycle cubren que Neon suspenda el
# compute y cierre las conexiones inactivas.
chat_engine = create_engine(
    DATABASE_URL,
    pool_size=5,
    max_overflow=5,
    pool_pre_ping=True,
    pool_recycle=240,
)

ChatSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,  # sesiones de vida corta: evita un refresh por commit
    bind=chat_engine,
)

class Base(DeclarativeBase):
    pass

# Dependencia para FastAPI
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()