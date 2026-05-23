"""Slack OAuth v2 routes."""

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.slack.oauth import build_authorize_url, exchange_code
from husn.core.config import get_settings
from husn.core.logging import log
from husn.core.oauth import make_state, verify_state
from husn.db.models import Connection
from husn.db.session import get_session

router = APIRouter(prefix="/auth/slack", tags=["auth"])


@router.get("/start")
async def start() -> RedirectResponse:
    s = get_settings()
    if not s.slack_client_id or not s.slack_client_secret:
        raise HTTPException(500, "SLACK_CLIENT_ID / SLACK_CLIENT_SECRET not configured")
    state = make_state(source="slack")
    url = build_authorize_url(
        client_id=s.slack_client_id, redirect_uri=s.slack_redirect_uri, state=state
    )
    return RedirectResponse(url, status_code=302)


@router.get("/callback")
async def callback(
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> HTMLResponse:
    if error:
        log.warning("husn.slack.oauth.error", error=error)
        return HTMLResponse(_page(f"<h1>Slack rejected the authorization</h1><pre>{error}</pre>"), status_code=400)

    if not code or not state:
        return HTMLResponse(_page("<h1>Missing code/state</h1>"), status_code=400)

    if not verify_state(state, expected_source="slack"):
        return HTMLResponse(_page("<h1>Invalid or expired state</h1><p>Try again.</p>"), status_code=400)

    s = get_settings()
    try:
        token = await exchange_code(
            code=code,
            client_id=s.slack_client_id,
            client_secret=s.slack_client_secret,
            redirect_uri=s.slack_redirect_uri,
        )
    except Exception as e:
        log.exception("husn.slack.oauth.exchange_failed")
        return HTMLResponse(_page(f"<h1>Token exchange failed</h1><pre>{e}</pre>"), status_code=500)

    # oauth.v2.access response shape:
    # {ok, access_token (bot), token_type, scope, bot_user_id,
    #  app_id, team:{id,name}, enterprise:..., authed_user:{id,...}}
    bot_token = token.get("access_token")
    bot_user_id = token.get("bot_user_id")
    team = token.get("team") or {}
    team_id = team.get("id")
    team_name = team.get("name")
    scope = token.get("scope")
    if not bot_token or not team_id:
        return HTMLResponse(_page(f"<h1>Unexpected token response</h1><pre>{token}</pre>"), status_code=500)

    stmt = (
        pg_insert(Connection)
        .values(
            source="slack",
            account_id=str(team_id),
            account_label=team_name or team_id,
            access_token=bot_token,
            refresh_token=None,  # bot tokens don't expire unless rotated by admin
            token_expires_at=None,
            scopes=scope,
            extra={"bot_user_id": bot_user_id, "team": team, "raw": token},
        )
        .on_conflict_do_update(
            constraint="uq_connection_source_account",
            set_={
                "access_token": bot_token,
                "scopes": scope,
                "account_label": team_name or team_id,
                "extra": {"bot_user_id": bot_user_id, "team": team, "raw": token},
            },
        )
        .returning(Connection.id)
    )
    result = await session.execute(stmt)
    conn_id = result.scalar_one()
    await session.commit()

    # Auto-enqueue backfill
    redis = await create_pool(RedisSettings.from_dsn(s.redis_url))
    try:
        await redis.enqueue_job("slack_backfill", conn_id)
    finally:
        await redis.close()

    log.info("husn.slack.oauth.connected", connection_id=conn_id, team_id=team_id, team_name=team_name)
    return HTMLResponse(
        _page(
            f"<h1>Slack connected</h1>"
            f"<p>Workspace: <strong>{team_name}</strong> <code>(team {team_id})</code></p>"
            f"<p>Backfill queued.</p>"
            f'<p><a href="http://localhost:3000">Back to dashboard</a> (refresh in ~30s)</p>'
        )
    )


@router.get("/status")
async def status(session: AsyncSession = Depends(get_session)) -> dict:
    result = await session.execute(select(Connection).where(Connection.source == "slack"))
    rows = result.scalars().all()
    return {
        "connections": [
            {
                "id": c.id,
                "account_id": c.account_id,
                "account_label": c.account_label,
                "team_id": c.account_id,
                "team_name": (c.extra or {}).get("team", {}).get("name"),
            }
            for c in rows
        ]
    }


def _page(body: str) -> str:
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>husn.io</title>
<style>
  body {{ font-family: ui-sans-serif, system-ui, sans-serif; background: #0b0d12; color: #e7eaf2; max-width: 640px; margin: 4rem auto; padding: 0 1.5rem; }}
  pre {{ background: #11141b; padding: 1rem; border-radius: 6px; overflow: auto; }}
  code {{ background: #11141b; padding: 2px 6px; border-radius: 4px; }}
  a {{ color: #6f7bff; }}
  h1 {{ font-size: 1.4rem; }}
</style></head><body>{body}</body></html>"""
