"""Chat-mode agent — same Groq backend, different prompt + smaller dossier.

The periodic agent (husn.agent.run) produces structured JSON for downstream
persistence. The chat agent is free-form: it answers the user's question in
natural language, citing claim_ids inline as `[claim N]` so the UI can link
back to source.

Dossier here is intentionally smaller than the periodic-agent dossier so the
chat history has room. ~2-3K tokens of project context, ~1K of history,
~1K system prompt, ~1K output → fits well under Groq's 6K TPM free tier.
"""

from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.agent.llm import LLMResult, get_llm_client
from husn.db.models import (
    Artifact,
    Claim,
    ClaimGroup,
    ClaimGroupMember,
    Finding,
    Project,
)

CHAT_MAX_ARTIFACTS = 25
CHAT_MAX_CLAIMS = 60
CHAT_MAX_BODY_CHARS = 220
CHAT_HISTORY_TURNS = 10  # most recent N turns sent to the LLM (sliding window)
# RAG retrieval: when the user message has matching keywords, pull the
# top-K matching artifacts in addition to the recency baseline.
RAG_TOP_K = 15
RAG_RECENT_FLOOR = 10  # always include at least this many most-recent items

CHAT_SYSTEM_PROMPT = """You are husn.io — a coordination agent helping a Technical Program Manager understand the operational state of their project.

You read a project dossier (artifacts from Jira / Slack / Gmail / Drive + extracted claims + open findings) and answer the user's questions about it. You speak in natural English, NOT JSON.

# Rules

1. ALWAYS ground your answers in the dossier. When you reference a fact, cite the supporting claim with inline `[claim N]` (e.g. "Launch was moved to June 10 [claim 28]"). When you reference an artifact (a doc, email, message), cite it as `[artifact N]`.
2. If the user asks something the dossier doesn't cover, say so honestly: "I don't see that in the current data — last sync was X." Do NOT make up information.
3. Anti-monitoring: NEVER score, rank, or call out individual people for being "behind", "unresponsive", "slow", etc. Talk about TEAMS, ARTIFACTS, and STATE OF WORK. If asked "is X person on track" — answer about the work, not the person.
4. Be concise. The TPM is busy — answer in 2-5 sentences unless the question demands depth.
5. Markdown is OK for lists and short emphasis. No headings. No code blocks unless quoting verbatim source.

# Useful patterns

- "What's the status of the launch date?" → look at claims of kind=date, key=launch/ship/release. Cite the latest commitment + any conflicting older sources.
- "Why did you flag <finding>?" → look at open_findings; explain the evidence claims.
- "Did anyone mention X?" → search artifact bodies; cite specific artifacts.
- "Draft a steerco update on Y" → produce a 4-6-bullet summary, every bullet citing claims.
""".strip()


# Pattern matches inline citations the LLM produces: [claim 12] or [artifact 5]
_CITATION_RE = re.compile(r"\[(claim|artifact)\s+(\d+)\]", re.IGNORECASE)


async def build_chat_dossier(
    session: AsyncSession, *, project_id: int, query: str | None = None
) -> dict[str, Any]:
    """Compact project snapshot for chat context.

    Strategy:
      1. Always include the RAG_RECENT_FLOOR most recent artifacts (so the
         agent has a baseline of "what just happened").
      2. If `query` is provided, run a keyword search across artifacts and
         pull the top RAG_TOP_K matches, deduped against the recency floor.
      3. Cap final list at CHAT_MAX_ARTIFACTS.
      4. Distribute across sources so one chatty source doesn't dominate.
    """
    project = await session.get(Project, project_id)
    if project is None:
        raise ValueError(f"project {project_id} not found")

    # 1. Recency floor — always present
    recent_rows = list(
        (
            await session.execute(
                select(Artifact)
                .where(Artifact.project_id == project_id)
                .order_by(desc(Artifact.occurred_at), desc(Artifact.id))
                .limit(RAG_RECENT_FLOOR * 3)  # wider pool for per-source distribution
            )
        )
        .scalars()
        .all()
    )

    # 2. Keyword-match RAG pull
    matched_rows: list[Artifact] = []
    if query:
        matched_rows = await _keyword_search(
            session, project_id=project_id, query=query, limit=RAG_TOP_K * 2
        )

    # 3. Merge: recent + matched, dedupe by id, distribute across sources
    seen_ids: set[int] = set()
    final_artifacts: list[Artifact] = []
    per_source_count: dict[str, int] = {}
    per_source_cap = max(3, CHAT_MAX_ARTIFACTS // 3 + 2)  # ~10 per source for cap of 25

    # Priority: matched rows first (most relevant to the question), then recent
    for a in list(matched_rows) + list(recent_rows):
        if a.id in seen_ids:
            continue
        if per_source_count.get(a.source, 0) >= per_source_cap:
            continue
        seen_ids.add(a.id)
        final_artifacts.append(a)
        per_source_count[a.source] = per_source_count.get(a.source, 0) + 1
        if len(final_artifacts) >= CHAT_MAX_ARTIFACTS:
            break

    # High-confidence claims linked to those artifacts
    claims_rows: list[Claim] = []
    if final_artifacts:
        claims_rows = list(
            (
                await session.execute(
                    select(Claim)
                    .where(Claim.source_artifact_id.in_([a.id for a in final_artifacts]))
                    .order_by(desc(Claim.confidence), desc(Claim.extracted_at))
                    .limit(CHAT_MAX_CLAIMS)
                )
            )
            .scalars()
            .all()
        )

    # Open findings (cheap to include + critical context)
    findings_rows = list(
        (
            await session.execute(
                select(Finding)
                .where(Finding.project_id == project_id, Finding.status == "open")
                .order_by(desc(Finding.opened_at))
            )
        )
        .scalars()
        .all()
    )

    def trunc(s: str | None) -> str | None:
        if s is None:
            return None
        s = s.strip()
        return (s[:CHAT_MAX_BODY_CHARS] + "…") if len(s) > CHAT_MAX_BODY_CHARS else s

    return {
        "project": {"id": project.id, "name": project.name},
        "artifacts": [
            {
                "id": a.id,
                "source": a.source,
                "kind": a.kind,
                "title": a.title,
                "body": trunc(a.body),
                "occurred_at": a.occurred_at.isoformat() if a.occurred_at else None,
                "url": a.url,
            }
            for a in final_artifacts
        ],
        "claims": [
            {
                "id": c.id,
                "artifact_id": c.source_artifact_id,
                "kind": c.kind,
                "key": c.key,
                "value_norm": c.value_norm,
                "confidence": c.confidence,
            }
            for c in claims_rows
        ],
        "open_findings": [
            {
                "id": f.id,
                "rule_id": f.rule_id,
                "summary": f.summary,
                "severity": f.severity,
            }
            for f in findings_rows
        ],
    }


async def _keyword_search(
    session: AsyncSession,
    *,
    project_id: int,
    query: str,
    limit: int,
) -> list[Artifact]:
    """Find artifacts whose title OR body contains any of the query's meaningful tokens.

    Postgres `ILIKE` is sufficient at the current artifact volume (~60 rows);
    upgrade to to_tsvector/to_tsquery + a GIN index when this becomes a hot path.
    Skip stopwords + very short tokens so the noise floor stays low.
    """
    tokens = _tokenize_query(query)
    if not tokens:
        return []

    from sqlalchemy import or_

    conds = []
    for t in tokens:
        pat = f"%{t}%"
        conds.append(Artifact.title.ilike(pat))
        conds.append(Artifact.body.ilike(pat))

    stmt = (
        select(Artifact)
        .where(Artifact.project_id == project_id, or_(*conds))
        .order_by(desc(Artifact.occurred_at), desc(Artifact.id))
        .limit(limit)
    )
    return list((await session.execute(stmt)).scalars().all())


_STOPWORDS: set[str] = {
    "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
    "have", "has", "had", "do", "does", "did", "of", "in", "on", "at", "to",
    "for", "with", "as", "by", "from", "into", "about", "what", "who", "how",
    "why", "when", "where", "this", "that", "these", "those", "it", "its",
    "any", "some", "all", "no", "yes", "i", "you", "we", "they", "he", "she",
    "my", "your", "our", "their", "me", "us", "them", "him", "her",
    "tell", "show", "give", "draft", "make", "ask",
}


def _tokenize_query(query: str) -> list[str]:
    """Lowercase, strip punctuation, drop stopwords + tokens shorter than 3 chars."""
    import re as _re

    raw = _re.findall(r"[A-Za-z0-9][A-Za-z0-9._-]+", query.lower())
    out: list[str] = []
    seen: set[str] = set()
    for tok in raw:
        if len(tok) < 3 or tok in _STOPWORDS or tok in seen:
            continue
        seen.add(tok)
        out.append(tok)
    return out


def extract_citations(text: str, dossier: dict[str, Any]) -> dict[str, list[int]]:
    """Pull out `[claim N]` / `[artifact N]` references from the assistant text
    and validate each against the dossier. Returns sorted unique id lists for
    persistence and UI rendering.
    """
    claim_ids_ok = {c["id"] for c in dossier.get("claims", [])}
    artifact_ids_ok = {a["id"] for a in dossier.get("artifacts", [])}

    cited_claims: set[int] = set()
    cited_artifacts: set[int] = set()
    for m in _CITATION_RE.finditer(text):
        kind = m.group(1).lower()
        try:
            ref_id = int(m.group(2))
        except ValueError:
            continue
        if kind == "claim" and ref_id in claim_ids_ok:
            cited_claims.add(ref_id)
        elif kind == "artifact" and ref_id in artifact_ids_ok:
            cited_artifacts.add(ref_id)
    return {
        "claim_ids": sorted(cited_claims),
        "artifact_ids": sorted(cited_artifacts),
    }


async def run_chat_turn(
    session: AsyncSession,
    *,
    project_id: int,
    history: list[dict[str, str]],
    user_message: str,
) -> dict[str, Any]:
    """Run one chat turn. Returns {reply, model, input_tokens, output_tokens, cited}.

    `history` is a list of {role, content} for prior turns (already capped to
    CHAT_HISTORY_TURNS by the caller).
    """
    dossier = await build_chat_dossier(
        session, project_id=project_id, query=user_message
    )
    dossier_json = json.dumps(dossier, ensure_ascii=False, separators=(",", ":"), default=str)

    system_with_dossier = CHAT_SYSTEM_PROMPT + "\n\n# Current project dossier\n\n<dossier>\n" + dossier_json + "\n</dossier>"

    client = get_llm_client()
    # We need a multi-turn conversation, not just system+single-user.
    # Provider-specific: Groq/OpenAI accept arrays via the OpenAI shape.
    # Our LLMClient.complete only takes system+user; for chat we go direct.
    result = await _call_with_history(
        client, system=system_with_dossier, history=history, user_message=user_message
    )
    cited = extract_citations(result.text, dossier)
    return {
        "reply": result.text,
        "model": client.model,
        "input_tokens": result.input_tokens,
        "output_tokens": result.output_tokens,
        "cited_claim_ids": cited["claim_ids"],
        "cited_artifact_ids": cited["artifact_ids"],
    }


async def _call_with_history(
    client: Any, *, system: str, history: list[dict[str, str]], user_message: str
) -> LLMResult:
    """Call the LLM with a full chat history. Provider-aware.

    Most providers accept the OpenAI-style messages array; we adapt for each
    backend we support.
    """
    provider = getattr(client, "provider", "ollama")

    if provider == "groq":
        # Same OpenAI-compatible shape, just include history.
        import httpx

        from husn.core.config import get_settings

        s = get_settings()
        messages = [{"role": "system", "content": system}]
        messages.extend(history)
        messages.append({"role": "user", "content": user_message})

        async with httpx.AsyncClient(timeout=s.llm_request_timeout_s) as h:
            r = await h.post(
                "https://api.groq.com/openai/v1/chat/completions",
                json={
                    "model": s.groq_model,
                    "messages": messages,
                    "temperature": 0.2,
                },
                headers={"Authorization": f"Bearer {s.groq_api_key}"},
            )
            r.raise_for_status()
            data = r.json()
        choice = (data.get("choices") or [{}])[0]
        text = (choice.get("message") or {}).get("content") or ""
        usage = data.get("usage") or {}
        return LLMResult(
            text=text,
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("completion_tokens"),
            raw=data,
        )

    if provider == "ollama":
        import httpx

        from husn.core.config import get_settings

        s = get_settings()
        messages = [{"role": "system", "content": system}]
        messages.extend(history)
        messages.append({"role": "user", "content": user_message})

        async with httpx.AsyncClient(timeout=s.llm_request_timeout_s) as h:
            r = await h.post(
                f"{s.ollama_base_url.rstrip('/')}/api/chat",
                json={
                    "model": s.ollama_model,
                    "messages": messages,
                    "stream": False,
                    "options": {"temperature": 0.2, "num_ctx": 8192},
                },
            )
            r.raise_for_status()
            data = r.json()
        text = (data.get("message") or {}).get("content") or ""
        return LLMResult(
            text=text,
            input_tokens=data.get("prompt_eval_count"),
            output_tokens=data.get("eval_count"),
            raw=data,
        )

    if provider == "anthropic":
        import httpx

        from husn.core.config import get_settings

        s = get_settings()
        # Anthropic doesn't take a system message in the messages array
        messages = list(history) + [{"role": "user", "content": user_message}]

        async with httpx.AsyncClient(timeout=s.llm_request_timeout_s) as h:
            r = await h.post(
                "https://api.anthropic.com/v1/messages",
                json={
                    "model": s.anthropic_model,
                    "system": system,
                    "messages": messages,
                    "max_tokens": 1024,
                    "temperature": 0.2,
                },
                headers={
                    "x-api-key": s.anthropic_api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
            )
            r.raise_for_status()
            data = r.json()
        parts = data.get("content") or []
        text = "".join(p.get("text", "") for p in parts if p.get("type") == "text")
        usage = data.get("usage") or {}
        return LLMResult(
            text=text,
            input_tokens=usage.get("input_tokens"),
            output_tokens=usage.get("output_tokens"),
            raw=data,
        )

    raise ValueError(f"chat not implemented for provider {provider}")
