"""Agent orchestrator — one run per project.

Run lifecycle:
  1. Open an `agent_runs` row (status='running') so we have a stable id for the briefs FK.
  2. Build the dossier.
  3. Call the LLM (via husn.agent.llm.get_llm_client()).
  4. Parse + validate JSON; drop invalid citations.
  5. Persist:
       findings  -> existing `findings` table with rule_id starting AGENT-FINDING-*
                    + finding_evidence rows for cited claim_ids
       briefs    -> new `briefs` table, one row per persona
       (recommendations are stored on the agent_run for now — surfaced later)
  6. Close the agent_runs row (status='ok' or 'failed').

Designed to be safe to call concurrently per-project (different runs operate
on separate ids). Within a single project, the cron only fires every 5 min
so contention is unlikely; if a run is in-progress, the next cron tick is
fine to start a fresh run.
"""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from husn.agent.context import build_dossier
from husn.agent.llm import get_llm_client, parse_json_response
from husn.agent.prompts import (
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    build_user_prompt,
    validate_agent_output,
)
from husn.core.logging import log
from husn.db.models import (
    AgentRun,
    Artifact,
    Brief,
    Claim,
    ClaimGroup,
    Finding,
    FindingEvidence,
    Project,
)


async def run_agent_for_project(
    session: AsyncSession, *, project_id: int, trigger: str = "manual"
) -> dict[str, Any]:
    """Run a single agent pass for one project. Returns a summary dict."""
    client = get_llm_client()

    # 1. Open agent_run row
    run = AgentRun(
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
        # 2. Dossier
        dossier = await build_dossier(session, project_id=project_id)
        if not dossier["claims"]:
            log.info(
                "husn.agent.skip_no_claims",
                project_id=project_id,
                run_id=run_id,
            )
            await _close_run(
                session,
                run_id=run_id,
                status="ok",
                error="no claims in dossier — nothing to reason over",
                started=started,
                findings=0,
                briefs=0,
            )
            return {"run_id": run_id, "status": "ok", "findings": 0, "briefs": 0}

        user_prompt = build_user_prompt(dossier)

        # 3. LLM
        result = await client.complete(system=SYSTEM_PROMPT, user=user_prompt, json_mode=True)

        # 4. Parse + validate
        try:
            payload = parse_json_response(result.text)
        except json.JSONDecodeError as e:
            log.exception(
                "husn.agent.parse_failed", run_id=run_id, text=result.text[:200]
            )
            await _close_run(
                session,
                run_id=run_id,
                status="failed",
                error=f"json parse: {e}",
                started=started,
                findings=0,
                briefs=0,
                raw_response=result.text[:4000],
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
            )
            return {"run_id": run_id, "status": "failed", "error": str(e)}

        sanitized = validate_agent_output(payload, dossier)

        # 5. Persist
        finding_count = await _persist_findings(
            session,
            project_id=project_id,
            findings=sanitized["findings"],
            agent_run_id=run_id,
            dossier=dossier,
        )
        brief_count = await _persist_briefs(
            session,
            project_id=project_id,
            briefs=sanitized["briefs"],
            run_id=run_id,
            model=client.model,
        )
        await session.commit()

        # 6. Close run
        await _close_run(
            session,
            run_id=run_id,
            status="ok",
            started=started,
            findings=finding_count,
            briefs=brief_count,
            raw_response=result.text[:4000],
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
        )

        log.info(
            "husn.agent.run.ok",
            project_id=project_id,
            run_id=run_id,
            findings=finding_count,
            briefs=brief_count,
            dropped=sanitized.get("_dropped"),
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
        )
        return {
            "run_id": run_id,
            "status": "ok",
            "findings": finding_count,
            "briefs": brief_count,
            "dropped": sanitized.get("_dropped"),
        }

    except Exception as e:
        log.exception("husn.agent.run.failed", project_id=project_id, run_id=run_id)
        # Roll back any half-finished transaction so the _close_run write can succeed.
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
            findings=0,
            briefs=0,
        )
        return {"run_id": run_id, "status": "failed", "error": str(e)}


async def run_agent_for_all_projects(
    session: AsyncSession, *, trigger: str = "cron"
) -> dict[int, Any]:
    """Run the agent over every project. Used by the cron task."""
    out: dict[int, Any] = {}
    projects = (await session.execute(select(Project))).scalars().all()
    for p in projects:
        out[p.id] = await run_agent_for_project(session, project_id=p.id, trigger=trigger)
    return out


# ---------- persistence helpers ----------


async def _persist_findings(
    session: AsyncSession,
    *,
    project_id: int,
    findings: list[dict[str, Any]],
    agent_run_id: int,
    dossier: dict[str, Any],
) -> int:
    """Each agent finding goes into the existing `findings` table.

    We need a claim_group_id for the unique constraint. Strategy:
      * The agent cites claim_ids — find their groups
      * If multiple groups, attach the finding to the most-cited group
      * If no group (claim isn't grouped yet) we still record it with
        claim_group_id = the first cited claim's id as a sentinel
        (claim_groups table is the right home long-term)
    """
    claim_to_group: dict[int, int] = {
        c["id"]: c["claim_group_id"]
        for c in dossier.get("claims", [])
        if c.get("claim_group_id") is not None
    }

    persisted = 0
    for f in findings:
        cids: list[int] = f["claim_ids"]
        # Pick the most-represented group from the cited claims
        group_counts: dict[int, int] = {}
        for cid in cids:
            gid = claim_to_group.get(cid)
            if gid is not None:
                group_counts[gid] = group_counts.get(gid, 0) + 1
        if group_counts:
            top_group = max(group_counts.items(), key=lambda kv: kv[1])[0]
        else:
            # No group info; synthesize a unique-per-finding pseudo group id by
            # using the negation of the agent_run_id+ordinal so we don't collide
            # with real claim_groups.
            top_group = -(agent_run_id * 1000 + persisted)

        # Upsert the open finding for (rule_id, claim_group_id)
        existing = (
            await session.execute(
                select(Finding).where(
                    Finding.rule_id == f["rule_id"],
                    Finding.claim_group_id == top_group,
                    Finding.status == "open",
                )
            )
        ).scalar_one_or_none()

        details = {
            "agent_run_id": agent_run_id,
            "claim_ids": cids,
            "source": "agent",
        }

        if existing is None:
            finding = Finding(
                rule_id=f["rule_id"],
                claim_group_id=top_group,
                project_id=project_id,
                status="open",
                severity=f["severity"],
                summary=f["summary"],
                details=details,
            )
            session.add(finding)
            await session.flush()
        else:
            existing.summary = f["summary"]
            existing.severity = f["severity"]
            existing.details = details
            existing.updated_at = datetime.now(UTC)
            finding = existing

        for cid in cids:
            await session.execute(
                pg_insert(FindingEvidence)
                .values(finding_id=finding.id, claim_id=cid, role="primary")
                .on_conflict_do_nothing(
                    index_elements=[FindingEvidence.finding_id, FindingEvidence.claim_id]
                )
            )
        persisted += 1

    return persisted


async def _persist_briefs(
    session: AsyncSession,
    *,
    project_id: int,
    briefs: list[dict[str, Any]],
    run_id: int,
    model: str,
) -> int:
    persisted = 0
    for b in briefs:
        all_cids: list[int] = []
        for blt in b["bullets"]:
            all_cids.extend(blt["claim_ids"])
        unique_cids = sorted(set(all_cids))
        brief = Brief(
            project_id=project_id,
            agent_run_id=run_id,
            persona=b["persona"],
            content={"headline": b["headline"], "bullets": b["bullets"]},
            source_claim_ids=unique_cids,
            model=model,
        )
        session.add(brief)
        persisted += 1
    if persisted:
        await session.flush()
    return persisted


async def _close_run(
    session: AsyncSession,
    *,
    run_id: int,
    status: str,
    started: float,
    findings: int,
    briefs: int,
    error: str | None = None,
    raw_response: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
) -> None:
    run = await session.get(AgentRun, run_id)
    if run is None:
        return
    run.status = status
    run.finished_at = datetime.now(UTC)
    run.duration_ms = int((time.perf_counter() - started) * 1000)
    run.finding_count = findings
    run.brief_count = briefs
    if error is not None:
        run.error = error[:1000]
    if raw_response is not None:
        run.raw_response = raw_response
    if input_tokens is not None:
        run.input_tokens = int(input_tokens)
    if output_tokens is not None:
        run.output_tokens = int(output_tokens)
    await session.commit()
