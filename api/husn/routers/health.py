from arq.connections import RedisSettings, create_pool
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from husn import __version__
from husn.core.config import get_settings
from husn.db.session import get_session

router = APIRouter(tags=["health"])


@router.get("/health/lite")
async def health_lite() -> dict[str, str]:
    """Cheap liveness check — no I/O. Use this for container HEALTHCHECK and
    load-balancer liveness probes that just need to know the process is up.
    """
    return {"status": "ok", "version": __version__}


@router.get("/health")
async def health(session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    """Full readiness check. Verifies DB + Redis are reachable. Returns 503 on
    either failure so Caddy/Hetzner can route around the box during outages.
    """
    s = get_settings()
    checks: dict[str, str] = {"db": "unknown", "redis": "unknown"}

    try:
        await session.execute(text("select 1"))
        checks["db"] = "ok"
    except Exception as e:  # pragma: no cover  (only fires on real outage)
        checks["db"] = f"fail: {type(e).__name__}"

    redis = None
    try:
        redis = await create_pool(RedisSettings.from_dsn(s.redis_url))
        pong = await redis.ping()
        checks["redis"] = "ok" if pong else "fail: no-pong"
    except Exception as e:  # pragma: no cover
        checks["redis"] = f"fail: {type(e).__name__}"
    finally:
        if redis is not None:
            await redis.close()

    if checks["db"] != "ok" or checks["redis"] != "ok":
        raise HTTPException(status_code=503, detail={"status": "unhealthy", **checks})

    return {"status": "ok", "version": __version__, **checks}


@router.get("/ready")
async def ready(session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    await session.execute(text("select 1"))
    return {"status": "ready", "db": "ok"}
