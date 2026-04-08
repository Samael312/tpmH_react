from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import JSONB
from app.db.base import Base


class Material(Base):
    """
    Recurso de estudio creado por un profesor.
    Puede ser un archivo (PDF, imagen) o un set de vocabulario.
    """
    __tablename__ = "materials"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)

    title = Column(String, nullable=False)
    description = Column(String, nullable=True)
    category = Column(String, nullable=False)
    # "grammar", "vocabulary", "reading", "exercises", "other"
    level = Column(String, nullable=True)
    # "A1", "A2", "B1", "B2", "C1", "C2"

    # Para archivos (PDF, imagen, video)
    file_url = Column(String, nullable=True)
    file_public_id = Column(String, nullable=True)  # Para borrar de Cloudinary
    file_type = Column(String, nullable=True)        # "pdf", "image", "video"

    # Para sets de vocabulario
    vocabulary_words = Column(JSONB, nullable=True)
    # ["apple", "banana", "cherry"]

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relaciones
    teacher = relationship("TeacherProfile", backref="materials")
    assignments = relationship("MaterialAssignment", back_populates="material")


class MaterialAssignment(Base):
    """
    Asignación de un material a un estudiante específico.
    Un material puede estar asignado a múltiples estudiantes.
    """
    __tablename__ = "material_assignments"

    id = Column(Integer, primary_key=True, index=True)
    material_id = Column(Integer, ForeignKey("materials.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)

    progress = Column(String, default="not_started")
    # "not_started", "in_progress", "completed"

    assigned_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Relaciones
    material = relationship("Material", back_populates="assignments")
    student = relationship("StudentProfile", backref="material_assignments")