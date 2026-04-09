from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List

from app.db.base import get_db
from app.auth.dependencies import get_current_student, get_current_user
from app.models.user import User
from app.models.review import Review
from app.models.class_ import Class
from app.models.teacher import TeacherProfile
from app.schemas.reviews import (
    CreateReviewRequest,
    ReviewResponse,
    TeacherRatingSummary,
)

router = APIRouter()


@router.post(
    "/{teacher_username}",
    response_model=ReviewResponse,
    status_code=status.HTTP_201_CREATED
)
def create_review(
    teacher_username: str,
    data: CreateReviewRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    El estudiante deja una reseña sobre un profesor.
    Requisito: haber tenido al menos una clase completada con él.
    Solo se puede dejar una reseña por profesor.
    """

    # 1. Buscar el profesor
    teacher = db.query(TeacherProfile).filter(
        TeacherProfile.user_username == teacher_username
    ).first()

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profesor no encontrado"
        )

    student_id = current_user.student_profile.id

    # 2. Verificar que han tenido al menos una clase completada
    completed_class = db.query(Class).filter(
        Class.teacher_id == teacher.id,
        Class.student_id == student_id,
        Class.status == "completed"
    ).first()

    if not completed_class:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo puedes dejar una reseña después de completar una clase"
        )

    # 3. Verificar que no ha dejado ya una reseña
    existing = db.query(Review).filter(
        Review.teacher_id == teacher.id,
        Review.student_id == student_id
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya has dejado una reseña para este profesor"
        )

    # 4. Crear la reseña
    review = Review(
        teacher_id=teacher.id,
        student_id=student_id,
        rating=data.rating,
        comment=data.comment,
    )
    db.add(review)
    db.commit()
    db.refresh(review)

    # Añadir datos del estudiante a la respuesta
    review.student_name = f"{current_user.name} {current_user.surname}"
    review.student_username = current_user.username

    return review


@router.get(
    "/{teacher_username}",
    response_model=List[ReviewResponse]
)
def get_teacher_reviews(
    teacher_username: str,
    db: Session = Depends(get_db)
):
    """
    Devuelve todas las reseñas de un profesor.
    Endpoint público — no requiere autenticación.
    """
    teacher = db.query(TeacherProfile).filter(
        TeacherProfile.user_username == teacher_username
    ).first()

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profesor no encontrado"
        )

    reviews = db.query(Review).filter(
        Review.teacher_id == teacher.id
    ).order_by(Review.created_at.desc()).all()

    # Enriquecer con datos del estudiante
    result = []
    for review in reviews:
        student_user = review.student.user
        r = ReviewResponse(
            id=review.id,
            teacher_id=review.teacher_id,
            student_id=review.student_id,
            rating=review.rating,
            comment=review.comment,
            created_at=review.created_at,
            student_name=f"{student_user.name} {student_user.surname}",
            student_username=student_user.username,
        )
        result.append(r)

    return result


@router.get(
    "/{teacher_username}/summary",
    response_model=TeacherRatingSummary
)
def get_teacher_rating_summary(
    teacher_username: str,
    db: Session = Depends(get_db)
):
    """
    Resumen de ratings del profesor.
    Usado para mostrar las estrellas en el perfil público.
    """
    teacher = db.query(TeacherProfile).filter(
        TeacherProfile.user_username == teacher_username
    ).first()

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profesor no encontrado"
        )

    reviews = db.query(Review).filter(
        Review.teacher_id == teacher.id
    ).all()

    if not reviews:
        return TeacherRatingSummary(
            average_rating=0.0,
            total_reviews=0,
            rating_distribution={"5": 0, "4": 0, "3": 0, "2": 0, "1": 0}
        )

    # Calcular promedio
    average = sum(r.rating for r in reviews) / len(reviews)

    # Distribución por estrellas
    distribution = {"5": 0, "4": 0, "3": 0, "2": 0, "1": 0}
    for review in reviews:
        star = str(int(review.rating))
        if star in distribution:
            distribution[star] += 1

    return TeacherRatingSummary(
        average_rating=round(average, 1),
        total_reviews=len(reviews),
        rating_distribution=distribution
    )


@router.delete("/{review_id}")
def delete_review(
    review_id: int,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """El estudiante elimina su propia reseña"""
    review = db.query(Review).filter(
        Review.id == review_id,
        Review.student_id == current_user.student_profile.id
    ).first()

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reseña no encontrada"
        )

    db.delete(review)
    db.commit()

    return {"message": "Reseña eliminada"}