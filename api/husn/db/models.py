from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from husn.db.base import Base


class RawArtifact(Base):
    """
    Raw, source-shaped ingested record. One row per (source, external_id, version).

    Normalization into the operational graph happens in Step 2; for Step 1
    we only persist what each connector returns, verbatim.
    """

    __tablename__ = "raw_artifacts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str] = mapped_column(String(256), nullable=False)
    version: Mapped[str] = mapped_column(String(64), nullable=False, default="1")
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("source", "external_id", "version", name="uq_raw_artifact_source_extid_ver"),
        Index("ix_raw_artifact_source_kind", "source", "kind"),
        Index("ix_raw_artifact_fetched_at", "fetched_at"),
    )
