from pydantic import BaseModel
from typing import Any, Optional, List
from datetime import datetime


class SystemCatalogResponse(BaseModel):
    key: str
    label: str
    value: Any
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class UpdateSystemCatalogRequest(BaseModel):
    value: Any


class BusinessRulesResponse(BaseModel):
    min_booking_hours: int
    min_cancel_hours: int
    min_reschedule_hours_student: int
    allowed_class_durations: List[int]
    allowed_package_durations: List[int]
    low_credit_threshold: int
    low_credit_renotify_days: int


class UpdateBusinessRulesRequest(BaseModel):
    min_booking_hours: Optional[int] = None
    min_cancel_hours: Optional[int] = None
    min_reschedule_hours_student: Optional[int] = None
    allowed_class_durations: Optional[List[int]] = None
    allowed_package_durations: Optional[List[int]] = None
    low_credit_threshold: Optional[int] = None
    low_credit_renotify_days: Optional[int] = None