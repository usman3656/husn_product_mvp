"""Google OAuth 2.0 routes."""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.google.oauth import (
    build_authorize_url,
    exchange_code,
    expires_at_from,
    get_userinfo,
)
from husn.core.config import get_settings
from husn.core.logging import log
from husn.core.oauth import make_state, verify_state
from husn.db.models import Connection
from husn.db.session import get_session

router = APIRouter(prefix="/auth/google", tags=["auth"])


@router.get("/start")
async def start() -> RedirectResponse:
    s = get_settings()
    if not s.google_client_id or not s.google_client_secret:
        raise HTTPException(500, "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured")
    state = make_state(source="google")
    url = build_authorize_url(
        client_id=s.google_client_id, redirect_uri=s.google_redirect_uri, state=state
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
        log.warning("husn.google.oauth.error", error=error)
        return HTMLResponse(
            _page(f"<h1>Google rejected the authorization</h1><pre>{error}</pre>"),
            status_code=400,
        )

    if not code or not state:
        return HTMLResponse(_page("<h1>Missing code/state</h1>"), status_code=400)

    if not verify_state(state, expected_source="google"):
        return HTMLResponse(
            _page("<h1>Invalid or expired state</h1><p>Try again.</p>"), status_code=400
        )

    s = get_settings()
    try:
        token = await exchange_code(
            code=code,
            client_id=s.google_client_id,
            client_secret=s.google_client_secret,
            redirect_uri=s.google_redirect_uri,
        )
    except Exception as e:
        log.exception("husn.google.oauth.exchange_failed")
        return HTMLResponse(
            _page(f"<h1>Token exchange failed</h1><pre>{e}</pre>"), status_code=500
        )

    access_token = token.get("access_token")
    refresh_token = token.get("refresh_token")
    expires_in = token.get("expires_in")
    scopes = token.get("scope")
    if not access_token:
        return HTMLResponse(
            _page(f"<h1>Unexpected token response</h1><pre>{token}</pre>"), status_code=500
        )

    try:
        userinfo = await get_userinfo(access_token)
    except Exception as e:
        log.exception("husn.google.oauth.userinfo_failed")
        return HTMLResponse(
            _page(f"<h1>userinfo failed</h1><pre>{e}</pre>"), status_code=500
        )

    sub = userinfo.get("sub")
    email = userinfo.get("email")
    name = userinfo.get("name")
    if not sub or not email:
        return HTMLResponse(
            _page(f"<h1>userinfo missing sub/email</h1><pre>{userinfo}</pre>"),
            status_code=500,
        )

    stmt = (
        pg_insert(Connection)
        .values(
            source="google",
            account_id=str(sub),
            account_label=email,
            access_token=access_token,
            refresh_token=refresh_token,
            token_expires_at=expires_at_from(expires_in),
            scopes=scopes,
            extra={"email": email, "name": name, "userinfo": userinfo},
        )
        .on_conflict_do_update(
            constraint="uq_connection_source_account",
            set_={
                "access_token": access_token,
                # Only overwrite refresh_token if a new one was returned. Google
                # sometimes omits it on re-consent if a valid one already exists.
                **(
                    {"refresh_token": refresh_token}
                    if refresh_token
                    else {}
                ),
                "token_expires_at": expires_at_from(expires_in),
                "scopes": scopes,
                "account_label": email,
                "extra": {"email": email, "name": name, "userinfo": userinfo},
            },
        )
        .returning(Connection.id)
    )
    result = await session.execute(stmt)
    conn_id = result.scalar_one()
    await session.commit()

    log.info("husn.google.oauth.connected", connection_id=conn_id, email=email)
    return HTMLResponse(
        _page(
            f"<h1>Google connected</h1>"
            f"<p>Authorized account: <strong>{email}</strong></p>"
            f"<p><strong>Next step:</strong> pick which Gmail labels + Drive folders to ingest "
            f'on the <a href="http://localhost:3000">dashboard</a> (Google panel).</p>'
            f"<p>Nothing is ingested until you select an allowlist.</p>"
        )
    )


@router.get("/status")
async def status(session: AsyncSession = Depends(get_session)) -> dict:
    result = await session.execute(select(Connection).where(Connection.source == "google"))
    rows = result.scalars().all()
    return {
        "connections": [
            {
                "id": c.id,
                "account_id": c.account_id,
                "account_label": c.account_label,
                "email": (c.extra or {}).get("email"),
                "name": (c.extra or {}).get("name"),
                "scopes": c.scopes,
                "token_expires_at": c.token_expires_at.isoformat()
                if c.token_expires_at
                else None,
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
