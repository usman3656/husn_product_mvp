"""Token-usage read endpoints — daily LLM consumption for Settings."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.deps import AuthContext, require_member
from husn.auth.scope import tenant_where
from husn.core.config import get_settings
from husn.db.models import TokenUsage
from husn.db.session import get_session
from husn.usage import get_provider_limits

router = APIRouter(prefix="/api/usage", tags=["usage"])


@router.get("/limits")
async def provider_limits(
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    """Live rate-limit snapshot from the LLM provider's last response headers —
    the REAL remaining quota (vs our own token ledger). Updated on every LLM
    call; None until the first call after deploy."""
    provider = get_settings().llm_provider
    return {"provider": provider, "limits": await get_provider_limits(provider)}


@router.get("/tokens")
async def token_usage(
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    """Daily token totals (UTC day) for the last 7 days, plus today's split by
    source. Tokens are summed across the agent renderer, web chat, and Slack."""
    day = cast(TokenUsage.created_at, Date)
    inp = func.coalesce(func.sum(TokenUsage.input_tokens), 0)
    out = func.coalesce(func.sum(TokenUsage.output_tokens), 0)

    since = datetime.now(UTC) - timedelta(days=7)
    rows = (
        await session.execute(
            tenant_where(
                select(day.label("day"), inp.label("inp"), out.label("out"))
                .where(TokenUsage.created_at >= since)
                .group_by(day)
                .order_by(day.desc()),
                TokenUsage,
                ctx,
            )
        )
    ).all()
    daily = [
        {"day": str(r.day), "input": int(r.inp), "output": int(r.out), "total": int(r.inp) + int(r.out)}
        for r in rows
    ]

    today_str = str(datetime.now(UTC).date())
    today = next(
        (d for d in daily if d["day"] == today_str),
        {"day": today_str, "input": 0, "output": 0, "total": 0},
    )

    src_rows = (
        await session.execute(
            tenant_where(
                select(TokenUsage.source, inp.label("inp"), out.label("out"))
                .where(cast(TokenUsage.created_at, Date) == datetime.now(UTC).date())
                .group_by(TokenUsage.source),
                TokenUsage,
                ctx,
            )
        )
    ).all()
    by_source = {r.source: int(r.inp) + int(r.out) for r in src_rows}

    return {"today": {**today, "by_source": by_source}, "daily": daily}
