from sqlalchemy import Column, Integer, String, Float, DateTime, Enum, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import JSONB
import enum
from app.db.base import Base

class TeacherStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    suspended = "suspended"

class TeacherProfile(Base):
    __tablename__ = "teacher_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    user_username = Column(String, nullable=False)
    bio = Column(String, nullable=True)
    title = Column(String, nullable=True)
    timezone = Column(String, default="UTC")
    languages = Column(JSONB, default=list)
    subjects = Column(JSONB, default=list)
    skills = Column(JSONB, default=list)
    certificates = Column(JSONB, default=list)
    gallery = Column(JSONB, default=list)
    students= Column(JSONB, default=list)
    social_links = Column(JSONB, default=dict)
    status = Column(Enum(TeacherStatus), default=TeacherStatus.pending)
    commission_rate = Column(Float, default=0.15)  # 15% por defecto
    balance = Column(Float, default=0.0)           # Ganancias acumuladas
    stripe_account_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    profile_photo_url = Column(String, nullable=True)
    profile_photo_public_id = Column(String, nullable=True)

    # ─── Video de presentación (obligatorio para aprobación) ───
    video_url = Column(String, nullable=True)
    video_public_id = Column(String, nullable=True)

    # ─── Personalización visual del perfil público ───
    theme_color = Column(String, nullable=True, default="#ec4899")

    # ─── Rechazo, retroalimentación y apelaciones ───
    # Motivo del rechazo más reciente. Se limpia cuando el profesor
    # vuelve a estar approved/pending tras subir un nuevo video.
    rejection_reason = Column(String, nullable=True)
    # False mientras el profesor no ha visto el banner de retroalimentación
    # en su dashboard tras un rechazo. Se pone en True al verlo.
    rejection_feedback_seen = Column(Boolean, default=True)
    # Cuántas apelaciones ha presentado en el ciclo de rechazo actual (0-2).
    appeal_count = Column(Integer, default=0)
    # True cuando agotó sus 2 apelaciones — status sigue "rejected" pero
    # se le habilita la opción de subir un nuevo video para reiniciar
    # el ciclo completo de revisión.
    appeal_exhausted = Column(Boolean, default=False)

    # Relaciones
    user = relationship("User", back_populates="teacher_profile", foreign_keys="TeacherProfile.user_id")
    packages = relationship("Package", back_populates="teacher")
    availability = relationship("TeacherAvailability", back_populates="teacher")
    availability_exceptions = relationship("TeacherAvailabilityException", back_populates="teacher")
    enrollments = relationship("Enrollment", back_populates="teacher")
    appeals = relationship("TeacherAppeal", back_populates="teacher", order_by="TeacherAppeal.created_at")

    # ─── Propiedades derivadas del usuario, expuestas en los schemas ───
    @property
    def name(self) -> str | None:
        return self.user.name if self.user else None

    @property
    def surname(self) -> str | None:
        return self.user.surname if self.user else None

    @property
    def nationality(self) -> str | None:   # ← NUEVO
        return self.user.nationality if self.user else None
