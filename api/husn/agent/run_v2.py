"""Step 5/6 v2 agent orchestrator.

Pipeline:
    build_skeleton  -> render -> validate -> nli_verify -> (retry|fallback) -> persist

The renderer never produces findings (those are deterministic, computed by
the drift evaluator). It never picks sides on conflicts (the skeleton already
contains both candidates side by side). The NLI verifier rejects sentences
that don't entail their cited claim's snippet; on rejection we retry up to N
times, then fall back to a deterministic template render.

Stage 1 scope:
  - Briefs persisted into the existing Brief table.
  - Verifier results, retry count, and fallback flag stash into Brief.content
    and AgentRun.raw_response since the audit-extension columns
    (briefs.skeleton, agent_runs.nli_fail_count) ship in Stage 2 via Alembic.
  - Personas: the fixed set ["TPM", "Eng Manager", "QA Lead", "Security Lead",
    "Ops Manager"]. Per-tenant persona config arrives with multi-tenancy
    in Stage 2.
"""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.agent.llm import RateLimitedError, get_llm_client, parse_json_response
from husn.agent.nli import NLIResult, verify_bullets
from husn.agent.render import (
    PROMPT_VERSION,
    RENDERER_SYSTEM_PROMPT,
    build_renderer_user_prompt,
    template_fallback,
    validate_renderer_output,
)
from husn.agent.skeleton import Skeleton, build_skeleton
from husn.core.logging import log
from husn.db.models import AgentRun, Brief, Project

DEFAULT_PERSONAS = ["TPM", "Eng Manager", "QA Lead", "Security Lead", "Ops Manager"]
MAX_RENDER_RETRIES = 2  # N=2 per §11.B exit criteria


async def run_renderer_for_project(
    session: AsyncSession,
    *,
    project_id: int,
    persona: str = "TPM",
    viewer_id: str | None = None,
    trigger: str = "manual",
    personas: list[str] | None = None,
) -> dict[str, Any]:
    """Run one v2 agent pass for one project. Returns a summary dict."""
    client = get_llm_client()
    personas = personas or DEFAULT_PERSONAS

    # Tenancy derives from the project (TENANCY.md C3).
    project = await session.get(Project, project_id)
    tenant_id = project.tenant_id if project else None

    run = AgentRun(
        tenant_id=tenant_id,
        project_id=project_id,
        trigger=trigger,
        status="running",
        model=client.model,
        provider=client.provider,
    )
    session.add(run)
    await session.flush()
    run_id = run.id
    await session.commit()

    started = time.perf_counter()
    try:
        skeleton = await build_skeleton(
            session,
            project_id=project_id,
            persona=persona,
            viewer_id=viewer_id,
        )

        if not skeleton.facts and not skeleton.conflicts:
            log.info(
                "husn.agent.v2.skip_empty_skeleton",
                project_id=project_id,
                run_id=run_id,
            )
            await _close_run(
                session,
                run_id=run_id,
                status="ok",
                error="empty skeleton — nothing to render",
                started=started,
                brief_count=0,
            )
            return {"run_id": run_id, "status": "ok", "briefs": 0, "reason": "empty"}

        user_prompt = build_renderer_user_prompt(skeleton, personas=personas)

        rendered, nli_result, fallback_used, attempts = await _render_and_verify(
            client=client, skeleton=skeleton, user_prompt=user_prompt
        )

        brief_count = await _persist_briefs(
            session,
            project_id=project_id,
            run_id=run_id,
            model=client.model,
            rendered=rendered,
            skeleton=skeleton,
            nli_result=nli_result,
            fallback_used=fallback_used,
            attempts=attempts,
            tenant_id=tenant_id,
        )
        await session.commit()

        await _close_run(
            session,
            run_id=run_id,
            status="ok",
            started=started,
            brief_count=brief_count,
            raw_response=json.dumps(
                {
                    "rendered": rendered,
                    "nli": {
                        "ok": nli_result.ok if nli_result else None,
                        "sentences_checked": (
                            nli_result.sentences_checked if nli_result else 0
                        ),
                        "failed_bullets": (
                            nli_result.failed_bullets if nli_result else []
                        ),
                    },
                    "attempts": attempts,
                    "fallback_used": fallback_used,
                    "prompt_version": PROMPT_VERSION,
                },
                default=str,
            )[:4000],
        )

        log.info(
            "husn.agent.v2.ok",
            project_id=project_id,
            run_id=run_id,
            brief_count=brief_count,
            attempts=attempts,
            fallback_used=fallback_used,
            facts=len(skeleton.facts),
            conflicts=len(skeleton.conflicts),
        )

        return {
            "run_id": run_id,
            "status": "ok",
            "briefs": brief_count,
            "attempts": attempts,
            "fallback_used": fallback_used,
            "facts": len(skeleton.facts),
            "conflicts": len(skeleton.conflicts),
        }

    except RateLimitedError as e:
        # Groq daily/minute cap — don't mark this run as a hard failure.
        # The next cron tick has another shot once the quota resets.
        log.warning(
            "husn.agent.v2.rate_limited",
            project_id=project_id,
            run_id=run_id,
            retry_after_s=e.retry_after_s,
        )
        try:
            await session.rollback()
        except Exception:
            pass
        await _close_run(
            session,
            run_id=run_id,
            status="rate_limited",
            error=f"rate-limited by {e.provider} — skipped",
            started=started,
            brief_count=0,
        )
        return {"run_id": run_id, "status": "rate_limited", "briefs": 0}

    except Exception as e:
        log.exception("husn.agent.v2.failed", project_id=project_id, run_id=run_id)
        try:
            await session.rollback()
        except Exception:
            pass
        await _close_run(
            session,
            run_id=run_id,
            status="failed",
            error=f"{type(e).__name__}: {e}"[:500],
            started=started,
            brief_count=0,
        )
        return {"run_id": run_id, "status": "failed", "error": str(e)}


async def run_renderer_for_all_projects(
    session: AsyncSession, *, trigger: str = "cron"
) -> dict[int, Any]:
    """Cron entry point. One pass per project."""
    out: dict[int, Any] = {}
    projects = (await session.execute(select(Project))).scalars().all()
    for p in projects:
        res = await run_renderer_for_project(
            session, project_id=p.id, trigger=trigger
        )
        out[p.id] = res
        if res.get("status") == "rate_limited":
            # The provider quota is global — every remaining project would just
            # 429 too. Stop now instead of hammering an exhausted quota; the
            # next tick retries once the window rolls over.
            log.warning(
                "husn.agent.v2.rate_limited.halt_loop",
                rendered=len(out),
                remaining=len(projects) - len(out),
            )
            break
    return out


# ---------- Render-then-verify with retry + template fallback ----------


async def _render_and_verify(
    *,
    client: Any,
    skeleton: Skeleton,
    user_prompt: str,
) -> tuple[dict[str, Any], NLIResult | None, bool, int]:
    """Returns (sanitised_rendered, nli_result, fallback_used, attempts).

    On JSON / shape failure, retries up to MAX_RENDER_RETRIES; on persistent
    NLI failure or persistent shape failure, falls back to template_fallback
    and reports fallback_used=True, nli_result=None.
    """
    attempts = 0
    last_sanitised: dict[str, Any] | None = None
    last_nli: NLIResult | None = None

    while attempts <= MAX_RENDER_RETRIES:
        attempts += 1
        try:
            result = await client.complete(
                system=RENDERER_SYSTEM_PROMPT, user=user_prompt, json_mode=True
            )
            payload = parse_json_response(result.text)
            sanitised = validate_renderer_output(payload, skeleton)
            last_sanitised = sanitised
        except (json.JSONDecodeError, ValueError) as e:
            log.warning("husn.agent.v2.render_parse_fail", attempt=attempts, err=str(e))
            continue

        # Collect every bullet across briefs so the NLI verifier sees them all.
        all_bullets: list[dict[str, Any]] = []
        for b in sanitised.get("briefs", []):
            all_bullets.extend(b.get("bullets", []))
        for c in sanitised.get("conflicts_rendered", []):
            all_bullets.append({"text": c.get("text"), "claim_ids": c.get("claim_ids", [])})

        if not all_bullets:
            log.warning("husn.agent.v2.render_empty", attempt=attempts)
            continue

        nli = await verify_bullets(bullets=all_bullets, skeleton=skeleton, llm=client)
        last_nli = nli
        if nli.ok:
            return sanitised, nli, False, attempts

        log.warning(
            "husn.agent.v2.nli_fail",
            attempt=attempts,
            fail_count=nli.fail_count,
            failed_bullets=nli.failed_bullets,
        )

    # Persistent failure — deterministic template render. Never lies, never
    # picks sides, always passes its own (trivial) validation.
    log.info("husn.agent.v2.fallback_template", attempts=attempts)
    return template_fallback(skeleton), last_nli, True, attempts


# ---------- Persistence ----------


async def _persist_briefs(
    session: AsyncSession,
    *,
    project_id: int,
    run_id: int,
    model: str,
    rendered: dict[str, Any],
    skeleton: Skeleton,
    nli_result: NLIResult | None,
    fallback_used: bool,
    attempts: int,
    tenant_id: int | None = None,
) -> int:
    """One Brief row per persona the renderer produced. Stage 2 will move
    the skeleton + verifier audit into dedicated columns.
    """
    briefs = rendered.get("briefs", []) or []
    conflicts_rendered = rendered.get("conflicts_rendered", []) or []
    persisted = 0

    for b in briefs:
        bullet_cids: list[int] = []
        for blt in b.get("bullets", []):
            bullet_cids.extend(blt.get("claim_ids", []))
        unique_cids = sorted(set(bullet_cids))

        content = {
            "headline": b.get("headline", ""),
            "bullets": b.get("bullets", []),
            "conflicts_rendered": conflicts_rendered,
            "prompt_version": PROMPT_VERSION,
            "fallback_used": fallback_used,
            "renderer_attempts": attempts,
            "nli": _nli_summary(nli_result),
            "skeleton_summary": {
                "facts": len(skeleton.facts),
                "conflicts": len(skeleton.conflicts),
                "blockers": len(skeleton.blockers_for_persona),
            },
        }

        brief = Brief(
            tenant_id=tenant_id,
            project_id=project_id,
            agent_run_id=run_id,
            persona=b.get("persona", "TPM"),
            content=content,
            source_claim_ids=unique_cids,
            model=model,
        )
        session.add(brief)
        persisted += 1

    if persisted:
        await session.flush()
    return persisted


def _nli_summary(nli: NLIResult | None) -> dict[str, Any]:
    if nli is None:
        return {"ran": False}
    return {
        "ran": True,
        "ok": nli.ok,
        "sentences_checked": nli.sentences_checked,
        "fail_count": nli.fail_count,
        "failed_bullets": nli.failed_bullets,
    }


# ---------- Close ----------


async def _close_run(
    session: AsyncSession,
    *,
    run_id: int,
    status: str,
    started: float,
    brief_count: int,
    error: str | None = None,
    raw_response: str | None = None,
) -> None:
    run = await session.get(AgentRun, run_id)
    if run is None:
        return
    run.status = status
    run.finished_at = datetime.now(UTC)
    run.duration_ms = int((time.perf_counter() - started) * 1000)
    run.brief_count = brief_count
    if error is not None:
        run.error = error[:1000]
    if raw_response is not None:
        run.raw_response = raw_response
    await session.commit()
