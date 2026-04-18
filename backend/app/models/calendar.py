from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base import Base
from datetime import datetime

class CalendarToken(Base):
    __tablename__ = "google_calendar"

    id            = Column(Integer, primary_key=True, index=True)
    user_id       = Column(Integer, ForeignKey("users.id"), unique=True)
    calendar_id   = Column(String, nullable=True)
    access_token  = Column(String, nullable=False)
    refresh_token = Column(String, nullable=True)
    token_expiry  = Column(String, nullable=True)
    sync_enabled  = Column(Boolean, default=True)
    last_sync_at  = Column(DateTime, nullable=True)
    created_at    = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="calendar_token")