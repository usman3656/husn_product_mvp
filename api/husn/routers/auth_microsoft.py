"""Microsoft Entra OAuth 2.0 routes (Outlook + OneDrive + SharePoint)."""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.connectors.microsoft.oauth import (
    build_authorize_url,
    exchange_code,
    expires_at_from,
    get_me,
)
from husn.core.config import get_settings
from husn.core.logging import log
from husn.core.oauth import make_state, verify_state
from husn.db.models import Connection
from husn.db.session import get_session

router = APIRouter(prefix="/auth/microsoft", tags=["auth"])


@router.get("/start")
async def start() -> RedirectResponse:
    s = get_settings()
    if not s.ms_client_id or not s.ms_client_secret:
        raise HTTPException(500, "MS_CLIENT_ID / MS_CLIENT_SECRET not configured")
    state = make_state(source="microsoft")
    url = build_authorize_url(
        tenant=s.ms_tenant,
        client_id=s.ms_client_id,
        redirect_uri=s.ms_redirect_uri,
        state=state,
    )
    return RedirectResponse(url, status_code=302)


@router.get("/callback")
async def callback(
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    error_description: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> HTMLResponse:
    if error:
        log.warning("husn.microsoft.oauth.error", error=error, description=error_description)
        return HTMLResponse(
            _page(f"<h1>Microsoft rejected the authorization</h1><pre>{error}: {error_description or ''}</pre>"),
            status_code=400,
        )

    if not code or not state:
        return HTMLResponse(_page("<h1>Missing code/state</h1>"), status_code=400)

    if not verify_state(state, expected_source="microsoft"):
        return HTMLResponse(
            _page("<h1>Invalid or expired state</h1><p>Try again.</p>"), status_code=400
        )

    s = get_settings()
    try:
        token = await exchange_code(
            tenant=s.ms_tenant,
            code=code,
            client_id=s.ms_client_id,
            client_secret=s.ms_client_secret,
            redirect_uri=s.ms_redirect_uri,
        )
    except Exception as e:  # pragma: no cover  (httpx raises during real OAuth only)
        log.exception("husn.microsoft.oauth.exchange_failed")
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
        me = await get_me(access_token)
    except Exception as e:
        log.exception("husn.microsoft.oauth.me_failed")
        return HTMLResponse(_page(f"<h1>/me failed</h1><pre>{e}</pre>"), status_code=500)

    account_id = me.get("id")
    upn = me.get("userPrincipalName") or me.get("mail")
    display_name = me.get("displayName")
    if not account_id:
        return HTMLResponse(
            _page(f"<h1>/me missing id</h1><pre>{me}</pre>"), status_code=500
        )

    stmt = (
        pg_insert(Connection)
        .values(
            source="microsoft",
            account_id=str(account_id),
            account_label=upn or display_name or account_id,
            access_token=access_token,
            refresh_token=refresh_token,
            token_expires_at=expires_at_from(expires_in),
            scopes=scopes,
            extra={"upn": upn, "display_name": display_name, "me": me},
        )
        .on_conflict_do_update(
            constraint="uq_connection_source_account",
            set_={
                "access_token": access_token,
                # Only overwrite refresh_token if a new one is present (Microsoft
                # always returns a new one, but defensive in case of partial response).
                **({"refresh_token": refresh_token} if refresh_token else {}),
                "token_expires_at": expires_at_from(expires_in),
                "scopes": scopes,
                "account_label": upn or display_name or account_id,
                "extra": {"upn": upn, "display_name": display_name, "me": me},
            },
        )
        .returning(Connection.id)
    )
    result = await session.execute(stmt)
    conn_id = result.scalar_one()
    await session.commit()

    log.info("husn.microsoft.oauth.connected", connection_id=conn_id, upn=upn)
    return HTMLResponse(
        _page(
            f"<h1>Microsoft connected</h1>"
            f"<p>Authorized account: <strong>{upn or display_name}</strong></p>"
            f"<p><strong>Next step:</strong> pick which Outlook folders + OneDrive folders "
            f'to ingest on the <a href="http://localhost:3000">dashboard</a> (Microsoft panel).</p>'
            f"<p>Nothing is ingested until you select an allowlist.</p>"
        )
    )


@router.get("/status")
async def status(session: AsyncSession = Depends(get_session)) -> dict:
    result = await session.execute(select(Connection).where(Connection.source == "microsoft"))
    rows = result.scalars().all()
    return {
        "connections": [
            {
                "id": c.id,
                "account_id": c.account_id,
                "account_label": c.account_label,
                "upn": (c.extra or {}).get("upn"),
                "display_name": (c.extra or {}).get("display_name"),
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
