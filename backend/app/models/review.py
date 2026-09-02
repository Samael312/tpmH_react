from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class Review(Base):
    """
    Reseña de un estudiante sobre un profesor.
    Solo pueden dejar reseña estudiantes que han tenido
    al menos una clase completada con ese profesor.

    Excepción: reseñas "legacy", cargadas desde el Modo Dios, hechas por
    estudiantes en la plataforma anterior que ya no están activos acá.
    Estas pueden o no estar ligadas a una cuenta real (student_id), según
    si esa cuenta todavía existe en este sistema o no — cuando no existe,
    student_id queda NULL y el nombre se guarda en legacy_student_name.
    """
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    # Nullable: una reseña legacy sin cuenta asociada no tiene student_id.
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=True)

    rating = Column(Float, nullable=False)       # 1.0 - 5.0
    comment = Column(String, nullable=True)
    # Representa la fecha "real" de la reseña: la fecha de creación del
    # registro para reseñas normales, o la fecha original en la
    # plataforma anterior cuando se carga una reseña legacy desde el
    # Modo Dios (queda editable, a diferencia de un created_at normal).
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # True para reseñas cargadas manualmente vía Modo Dios (migración de
    # la plataforma anterior), no creadas por el flujo normal del alumno.
    is_legacy = Column(Boolean, nullable=False, server_default="false", default=False)
    # Nombre a mostrar cuando no hay student_id (la cuenta no existe en
    # este sistema). Si hay student_id, se usa el nombre real del alumno
    # y este campo queda como referencia/override opcional.
    legacy_student_name = Column(String, nullable=True)

    # Cuántas clases completó el alumno CON ESTE PROFESOR (no el contador
    # de por vida en todas las plataformas/profesores). NULL = calcularlo
    # en vivo a partir de Class/ClassParticipant (solo posible si hay
    # student_id). Para reseñas legacy este valor casi siempre hay que
    # cargarlo a mano desde Modo Dios, porque las clases de la plataforma
    # anterior no están en esta base de datos. También sirve para
    # corregir el número en una reseña normal si hiciera falta.
    total_completed_classes = Column(Integer, nullable=True)

    # Relaciones
    teacher = relationship("TeacherProfile", backref="reviews")
    student = relationship("StudentProfile", backref="reviews")