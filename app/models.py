from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Draw(Base):
    __tablename__ = "draws"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(120), default="Intercambio de Regalos")
    budget: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    event_date: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    event_location: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | drawn
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    drawn_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    participants: Mapped[list["Participant"]] = relationship(
        "Participant",
        back_populates="draw",
        cascade="all, delete-orphan",
        order_by="Participant.id",
    )


class Participant(Base):
    __tablename__ = "participants"
    __table_args__ = (
        UniqueConstraint("draw_id", "name", name="uq_participant_draw_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    draw_id: Mapped[int] = mapped_column(ForeignKey("draws.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    wishlist: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    assigned_to_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("participants.id", ondelete="SET NULL"),
        nullable=True,
    )
    revealed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    draw: Mapped["Draw"] = relationship("Draw", back_populates="participants")
    assigned_to: Mapped[Optional["Participant"]] = relationship(
        "Participant",
        remote_side=[id],
        uselist=False,
        post_update=True,
    )


class SecretMessage(Base):
    __tablename__ = "secret_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    draw_id: Mapped[int] = mapped_column(ForeignKey("draws.id", ondelete="CASCADE"), index=True)
    giver_id: Mapped[int] = mapped_column(ForeignKey("participants.id", ondelete="CASCADE"), index=True)
    receiver_id: Mapped[int] = mapped_column(ForeignKey("participants.id", ondelete="CASCADE"), index=True)
    sender_role: Mapped[str] = mapped_column(String(16), nullable=False)  # "giver" | "receiver"
    content: Mapped[str] = mapped_column(String(400), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
