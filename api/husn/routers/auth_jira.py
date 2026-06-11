"""Jira (Atlassian) OAuth 2.0 (3LO) routes.

Connector OAuth is an ADMIN action (TENANCY.md D5): /start requires an
admin session; the workspace rides the signed state through the provider
dance; /callback stamps tenant_id on the Connection row.

Site picker (added 2026-06-11): Atlassian's accessible-resources endpoint
returns every Jira site the user can access; their consent screen has no
per-site selector. So when an OAuth grant comes back with >1 site, we stash
the token in Redis briefly and redirect to /auth/jira/select where the user
picks which sites to actually connect. Single-site grants pass through
unchanged.
"""

import html as html_lib
import json
import secrets

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, Form, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.auth.deps import AuthContext, require_admin
from husn.auth.scope import tenant_where
from husn.auth.sessions import get_redis
from husn.connectors.jira.oauth import (
    build_authorize_url,
    exchange_code,
    expires_at_from,
    list_accessible_resources,
)
from husn.core.config import get_settings
from husn.core.logging import log
from husn.core.oauth import make_state, parse_state
from husn.db.models import Connection
from husn.db.session import get_session

router = APIRouter(prefix="/auth/jira", tags=["auth"])

_PICKER_TTL_SECONDS = 600  # 10 minutes — user has time to pick + submit


def _picker_key(tag: str) -> str:
    return f"jira_oauth_pending:{tag}"


@router.get("/start")
async def start(ctx: AuthContext = Depends(require_admin)) -> RedirectResponse:
    s = get_settings()
    if not s.jira_client_id or not s.jira_client_secret:
        raise HTTPException(500, "JIRA_CLIENT_ID / JIRA_CLIENT_SECRET not configured")
    state = make_state(source="jira", tenant_id=ctx.tenant_id, user_id=ctx.user_id)
    url = build_authorize_url(
        client_id=s.jira_client_id, redirect_uri=s.jira_redirect_uri_resolved, state=state
    )
    return RedirectResponse(url, status_code=302)


@router.get("/callback")
async def callback(
    code: str = Query(...),
    state: str = Query(...),
    error: str | None = Query(None),
    error_description: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> HTMLResponse:
    if error:
        log.warning("husn.jira.oauth.error", error=error, description=error_description)
        return HTMLResponse(
            _page(f"<h1>Atlassian rejected the authorization</h1><pre>{error}: {error_description or ''}</pre>"),
            status_code=400,
        )

    state_payload = parse_state(state, expected_source="jira")
    if state_payload is None:
        return HTMLResponse(_page("<h1>Invalid or expired state</h1><p>Try again.</p>"), status_code=400)
    # None during the AUTH_REQUIRED=0 bridge; the workspace id after C4.
    tenant_id = state_payload.get("tid")

    s = get_settings()
    try:
        token = await exchange_code(
            code=code,
            client_id=s.jira_client_id,
            client_secret=s.jira_client_secret,
            redirect_uri=s.jira_redirect_uri_resolved,
        )
    except Exception as e:  # pragma: no cover  (httpx raises during real OAuth only)
        log.exception("husn.jira.oauth.exchange_failed")
        return HTMLResponse(_page(f"<h1>Token exchange failed</h1><pre>{e}</pre>"), status_code=500)

    access_token = token["access_token"]
    refresh_token = token.get("refresh_token")
    expires_in = token.get("expires_in")
    scopes = token.get("scope")

    try:
        resources = await list_accessible_resources(access_token)
    except Exception as e:  # pragma: no cover
        log.exception("husn.jira.oauth.resources_failed")
        return HTMLResponse(_page(f"<h1>accessible-resources failed</h1><pre>{e}</pre>"), status_code=500)

    valid_resources = [r for r in resources if r.get("id")]
    if not valid_resources:
        return HTMLResponse(
            _page("<h1>No Atlassian sites accessible</h1><p>Grant access to at least one site.</p>"),
            status_code=400,
        )

    # Site picker: if Atlassian returned more than one site, let the user
    # pick which to actually connect. Atlassian's consent screen has no
    # per-site selector, so without this we'd silently create N connections.
    if len(valid_resources) > 1:
        tag = secrets.token_urlsafe(16)
        await get_redis().set(
            _picker_key(tag),
            json.dumps({
                "tenant_id": tenant_id,
                "access_token": access_token,
                "refresh_token": refresh_token,
                "expires_in": expires_in,
                "scopes": scopes,
                "resources": valid_resources,
            }),
            ex=_PICKER_TTL_SECONDS,
        )
        return RedirectResponse(
            f"{s.public_api_base_url.rstrip('/')}/auth/jira/select?k={tag}",
            status_code=302,
        )

    upserted: list[dict] = []
    for r in valid_resources:
        cloud_id = r.get("id")
        site_url = r.get("url")
        site_name = r.get("name")
        if not cloud_id:
            continue
        # NOTE: the conflict target is still the GLOBAL (source, account_id)
        # constraint until migration 0010 re-keys it to (tenant_id, source,
        # account_id) at the C4 cutover — the C4 commit updates this name.
        stmt = (
            pg_insert(Connection)
            .values(
                tenant_id=tenant_id,
                source="jira",
                account_id=str(cloud_id),
                account_label=site_name or site_url,
                access_token=access_token,
                refresh_token=refresh_token,
                token_expires_at=expires_at_from(expires_in),
                scopes=scopes,
                extra={"site_url": site_url, "cloud_id": cloud_id, "raw_resource": r},
            )
            .on_conflict_do_update(
                constraint="uq_connection_tenant_source_account",
                set_={
                    "tenant_id": tenant_id,
                    "access_token": access_token,
                    "refresh_token": refresh_token,
                    "token_expires_at": expires_at_from(expires_in),
                    "scopes": scopes,
                    "account_label": site_name or site_url,
                    "extra": {"site_url": site_url, "cloud_id": cloud_id, "raw_resource": r},
                },
            )
            .returning(Connection.id)
        )
        result = await session.execute(stmt)
        conn_id = result.scalar_one()
        upserted.append({"id": conn_id, "cloud_id": cloud_id, "site": site_url})
    await session.commit()

    # Auto-enqueue backfill for each new/refreshed connection
    redis = await create_pool(RedisSettings.from_dsn(s.redis_url))
    try:
        for u in upserted:
            await redis.enqueue_job("jira_backfill", u["id"])
    finally:
        await redis.close()

    log.info("husn.jira.oauth.connected", connections=upserted)
    sites_html = "".join(
        f"<li><strong>{u['site']}</strong> <code>(cloudId: {u['cloud_id']})</code></li>"
        for u in upserted
    )
    return HTMLResponse(
        _page(
            f"<h1>Jira connected</h1>"
            f"<p>{len(upserted)} site(s) authorized; backfill queued.</p>"
            f"<ul>{sites_html}</ul>"
            f'<p><a href="{s.public_web_base_url}">Back to dashboard</a> (refresh in ~30s to see issues)</p>'
        )
    )


@router.get("/select")
async def select_sites(k: str = Query(...)) -> HTMLResponse:
    """Pending-OAuth site picker. Reads the stashed token + resources from
    Redis and renders a checkbox form. POST → /auth/jira/finalize."""
    raw = await get_redis().get(_picker_key(k))
    if raw is None:
        return HTMLResponse(
            _page("<h1>Session expired</h1><p>Start the Atlassian connection again.</p>"),
            status_code=400,
        )
    pending = json.loads(raw)
    resources = pending["resources"]
    rows = "".join(
        f"""
        <label class="site">
          <input type="checkbox" name="cloud_id" value="{html_lib.escape(str(r['id']))}" {'checked' if i == 0 else ''} />
          <span>
            <strong>{html_lib.escape(r.get('name') or r.get('url') or r['id'])}</strong>
            <code>{html_lib.escape(r.get('url') or '')}</code>
          </span>
        </label>
        """
        for i, r in enumerate(resources)
    )
    return HTMLResponse(
        _page(
            f"""
            <h1>Pick the Jira sites to connect</h1>
            <p>Atlassian gave us access to {len(resources)} sites. Tick the ones you actually want to hand to Husn — the rest stay untouched.</p>
            <form method="POST" action="/auth/jira/finalize" class="picker">
              <input type="hidden" name="k" value="{html_lib.escape(k)}" />
              {rows}
              <button type="submit">Connect selected sites</button>
            </form>
            """,
            extra_css=(
                "label.site { display: flex; align-items: flex-start; gap: 0.6rem; padding: 0.75rem 1rem; border: 1px solid #2a2f3a; border-radius: 8px; margin: 0.5rem 0; cursor: pointer; }"
                "label.site input { margin-top: 4px; }"
                "label.site strong { display: block; }"
                "label.site code { color: #9aa2b1; font-size: 12px; }"
                "form.picker button { margin-top: 1.25rem; background: #6f7bff; color: white; border: 0; padding: 0.55rem 1rem; border-radius: 999px; font-weight: 600; cursor: pointer; }"
            ),
        )
    )


@router.post("/finalize")
async def finalize(
    k: str = Form(...),
    cloud_id: list[str] = Form(default=[]),
    session: AsyncSession = Depends(get_session),
) -> HTMLResponse:
    """Complete a multi-site Jira OAuth by creating Connection rows only for
    the sites the user actually ticked."""
    redis = get_redis()
    raw = await redis.get(_picker_key(k))
    if raw is None:
        return HTMLResponse(
            _page("<h1>Session expired</h1><p>Start the Atlassian connection again.</p>"),
            status_code=400,
        )
    pending = json.loads(raw)
    if not cloud_id:
        return HTMLResponse(
            _page("<h1>No sites selected</h1><p>Pick at least one site to connect.</p>"),
            status_code=400,
        )

    s = get_settings()
    selected_ids = set(cloud_id)
    upserted: list[dict] = []
    for r in pending["resources"]:
        if str(r.get("id")) not in selected_ids:
            continue
        cid = r.get("id")
        site_url = r.get("url")
        site_name = r.get("name")
        stmt = (
            pg_insert(Connection)
            .values(
                tenant_id=pending["tenant_id"],
                source="jira",
                account_id=str(cid),
                account_label=site_name or site_url,
                access_token=pending["access_token"],
                refresh_token=pending.get("refresh_token"),
                token_expires_at=expires_at_from(pending.get("expires_in")),
                scopes=pending.get("scopes"),
                extra={"site_url": site_url, "cloud_id": cid, "raw_resource": r},
            )
            .on_conflict_do_update(
                constraint="uq_connection_tenant_source_account",
                set_={
                    "tenant_id": pending["tenant_id"],
                    "access_token": pending["access_token"],
                    "refresh_token": pending.get("refresh_token"),
                    "token_expires_at": expires_at_from(pending.get("expires_in")),
                    "scopes": pending.get("scopes"),
                    "account_label": site_name or site_url,
                    "extra": {"site_url": site_url, "cloud_id": cid, "raw_resource": r},
                },
            )
            .returning(Connection.id)
        )
        result = await session.execute(stmt)
        upserted.append({"id": result.scalar_one(), "cloud_id": cid, "site": site_url})

    await session.commit()
    await redis.delete(_picker_key(k))

    arq_redis = await create_pool(RedisSettings.from_dsn(s.redis_url))
    try:
        for u in upserted:
            await arq_redis.enqueue_job("jira_backfill", u["id"])
    finally:
        await arq_redis.close()

    log.info("husn.jira.oauth.connected", connections=upserted, picker=True)
    return HTMLResponse(
        _page(
            f"<h1>Jira connected</h1>"
            f"<p>{len(upserted)} site(s) connected; backfill queued.</p>"
            f'<p><a href="{s.public_web_base_url}/connections">Back to Connections</a></p>'
        )
    )


@router.get("/status")
async def status(
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_admin),
) -> dict:
    stmt = tenant_where(select(Connection).where(Connection.source == "jira"), Connection, ctx)
    result = await session.execute(stmt)
    rows = result.scalars().all()
    return {
        "connections": [
            {
                "id": c.id,
                "account_id": c.account_id,
                "account_label": c.account_label,
                "site_url": (c.extra or {}).get("site_url"),
                "token_expires_at": c.token_expires_at.isoformat() if c.token_expires_at else None,
            }
            for c in rows
        ]
    }


def _page(body: str, extra_css: str = "") -> str:
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>husn.io</title>
<style>
  body {{ font-family: ui-sans-serif, system-ui, sans-serif; background: #0b0d12; color: #e7eaf2; max-width: 640px; margin: 4rem auto; padding: 0 1.5rem; }}
  pre {{ background: #11141b; padding: 1rem; border-radius: 6px; overflow: auto; }}
  code {{ background: #11141b; padding: 2px 6px; border-radius: 4px; }}
  a {{ color: #6f7bff; }}
  h1 {{ font-size: 1.4rem; }}
  {extra_css}
</style></head><body>{body}</body></html>"""
