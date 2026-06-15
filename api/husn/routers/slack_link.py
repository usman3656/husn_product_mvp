"""Slack account linking — connect a Slack user to a Husn account.

The bot DMs an unlinked user a link to {web}/slack/link?token=…; that page
(signed in to Husn) previews which Slack user will be linked and POSTs the
confirm. The token is signed (husn.core.oauth) and short-lived. Linking is
gated by require_member + CSRF on the POST so it can't be auto-submitted
cross-site.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.deps import AuthContext, require_member
from husn.core.logging import log
from husn.core.oauth import read_token
from husn.db.models import SlackIdentity
from husn.db.session import get_session

router = APIRouter(prefix="/api/slack", tags=["slack"])

LINK_TOKEN_SOURCE = "slack_link"
LINK_TOKEN_TTL_S = 86400  # 24h — the user may click the DM'd link later


@router.get("/link/preview")
async def link_preview(
    token: str = Query(...),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    """Show which Slack user a token will link, so the signed-in user can
    confirm it's really theirs before binding it."""
    payload = read_token(token, expected_source=LINK_TOKEN_SOURCE, max_age_s=LINK_TOKEN_TTL_S)
    if not payload:
        raise HTTPException(400, "This link is invalid or has expired. Message the bot again for a fresh one.")
    return {
        "slack_team_id": payload.get("team"),
        "slack_user_id": payload.get("user"),
        "husn_email": ctx.email,
    }


class LinkRequest(BaseModel):
    token: str


@router.post("/link")
async def link(
    body: LinkRequest,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    payload = read_token(body.token, expected_source=LINK_TOKEN_SOURCE, max_age_s=LINK_TOKEN_TTL_S)
    if not payload:
        raise HTTPException(400, "This link is invalid or has expired.")
    team_id = payload.get("team")
    slack_user_id = payload.get("user")
    if not team_id or not slack_user_id:
        raise HTTPException(400, "malformed link token")

    # Bind (team, slack_user) → this signed-in Husn user. Re-linking updates
    # the owner (e.g. the same Slack user moving to a different Husn account).
    stmt = (
        pg_insert(SlackIdentity)
        .values(
            slack_team_id=str(team_id),
            slack_user_id=str(slack_user_id),
            user_id=ctx.user_id,
            tenant_id=ctx.tenant_id,
        )
        .on_conflict_do_update(
            constraint="uq_slack_identity_team_user",
            set_={"user_id": ctx.user_id, "tenant_id": ctx.tenant_id},
        )
    )
    await session.execute(stmt)
    await session.commit()
    log.info(
        "husn.slack.linked",
        user_id=ctx.user_id,
        tenant_id=ctx.tenant_id,
        slack_user_id=slack_user_id,
    )
    return {"status": "ok"}
