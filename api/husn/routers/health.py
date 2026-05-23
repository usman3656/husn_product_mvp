from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from husn import __version__
from husn.db.session import get_session

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@router.get("/ready")
async def ready(session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    await session.execute(text("select 1"))
    return {"status": "ready", "db": "ok"}
