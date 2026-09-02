from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import JSONB
from app.db.base import Base

class StudentProfile(Base):
    __tablename__ = "student_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    user_username = Column(String, nullable=False) # Tip: esto también podrías obtenerlo de user.username
    timezone = Column(String, default="UTC")
    goal = Column(String, nullable=True)
    teacher_username = Column(String, nullable=True)
    preferred_payment_methods = Column(JSONB, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    profile_photo_url = Column(String, nullable=True)
    profile_photo_public_id = Column(String, nullable=True)

    # Contador de por vida de clases completadas (individuales + grupales),
    # independiente de enrollments/paquetes: no se resetea con renovaciones
    # ni cambios de paquete. Se incrementa/decrementa cuando una clase
    # entra/sale de {"completed", "no_show"} — ver
    # app.core.class_logic.update_student_lifetime_class_counter.
    total_completed_classes = Column(Integer, default=0, nullable=False, server_default="0")

    # Relaciones
    user = relationship("User", back_populates="student_profile")
    enrollments = relationship("Enrollment", back_populates="student")
