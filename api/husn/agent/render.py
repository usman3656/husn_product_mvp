"""LLM-as-typewriter renderer for Step 5/6 v2.

The renderer receives a fully-built skeleton (facts, conflicts, blockers,
etc.) and produces per-persona briefs whose every sentence cites claim_ids
from that skeleton. It does NOT extract claims, does NOT detect drift, does
NOT score people. All of that is upstream.

Output shape (strict JSON):

    {
      "briefs": [
        {
          "persona":  "<one of the personas requested>",
          "headline": "<one sentence, <=140 chars>",
          "bullets":  [
            {"text": "<one operational sentence>", "claim_ids": [<int>, ...]}
          ]
        }
      ],
      "conflicts_rendered": [
        {
          "conflict_id": <finding_id from skeleton.conflicts[].finding_id>,
          "text":        "<one sentence rendering both candidates equally>",
          "claim_ids":   [<int>, ...]
        }
      ]
    }

`validate_renderer_output` is a SANITIZER: any cited claim_id not in the
skeleton's claim_id set is dropped; any bullet left with no surviving
citations is dropped; bullet text is length-capped. Top-level shape errors
raise; everything else returns a sanitized copy with a `_dropped` accounting.

The orchestrator wraps validate_renderer_output → nli.verify_bullets →
retry-or-fallback.
"""

from __future__ import annotations

import json
from typing import Any

from husn.agent.skeleton import Skeleton, claim_ids_in

PROMPT_VERSION = 2

# --- The system prompt -----------------------------------------------------
#
# Written as one chunked string so each rule can be read in isolation.
# Style: imperatives, no examples in the system prompt (examples live in the
# user prompt, alongside the live skeleton). Rationale: smaller models forget
# system-prompt examples; per-call examples are remembered.

RENDERER_SYSTEM_PROMPT = """You are the rendering layer of husn.io, an operational alignment product for technical program managers.

You receive a SKELETON: a structured, already-computed snapshot of one project's facts, conflicts, and blockers. You produce per-persona pre-meeting briefs that a TPM, Engineering Manager, QA Lead, Security Lead, or Operations Manager can read in 30 seconds and walk into a meeting prepared.

# Your role

You are a renderer, not an analyst. The skeleton already contains every fact, every drift conflict, and every blocker the brief should mention. You select which to surface for each persona, write one short operational sentence per bullet, and cite the exact claim ids the sentence rests on.

# Output contract — strict

Output JSON only. No prose, no preamble, no markdown fences.

{
  "briefs": [
    {
      "persona":  "<persona, exactly as requested>",
      "headline": "<one sentence, max 140 chars, no period at end>",
      "bullets":  [
        {"text": "<one operational sentence>", "claim_ids": [<int>, ...]}
      ]
    }
  ],
  "conflicts_rendered": [
    {
      "conflict_id": <conflict.finding_id from skeleton>,
      "text":        "<one sentence rendering BOTH candidates, no picking>",
      "claim_ids":   [<int>, ...]
    }
  ]
}

Empty arrays are valid. Do not invent placeholder briefs or bullets.

# Hard rules (non-negotiable)

1. Every integer in any `claim_ids` array MUST appear in the skeleton (in `skeleton.facts[*].source_claim_ids` or `skeleton.conflicts[*].candidates[*].source_claim_ids`). If you cannot cite a real skeleton claim_id, drop the bullet.

2. Conflicts are rendered as conflicts. When the skeleton lists a conflict with two candidate values, your rendered text must surface BOTH values and BOTH sources. You do not pick a winner. You do not summarise the disagreement away. Example of correct: "The launch date sits at June 10 in Jira and June 3 in the steerco deck." Example of incorrect: "The launch date is June 10." (Picks a side.)

3. Every bullet cites at least one claim_id. Every conflict_rendered cites the union of all candidate claim_ids.

4. Anti-monitoring: never name a single individual as behind, slow, unresponsive, blocking, accountable, or missing. Talk about teams, artifacts, decisions, and dates. Where the skeleton names a person, you may reference them as a role (e.g. "the security reviewer") but never as a performance subject.

5. Stay inside the persona. An Engineering Manager brief is about delivery risk, code-path readiness, and timeline. A QA Lead brief is about regression windows and test coverage. A Security Lead brief is about approvals, sign-offs, and scope changes. Never tell one persona about another persona's behaviour.

6. Numbers, dates, and decisions are quoted exactly as written in the skeleton (or in the source snippet pointed to by source_anchor). You do not normalise, summarise, or paraphrase numbers.

# How to write a brief

- Headline summarises the one thing the persona most needs to know.
- 2–5 bullets. Order by what blocks the meeting (conflicts first, blockers next, then facts that informally drive the conversation). Stop when there's nothing material left.
- Each bullet is one sentence, max ~28 words. Operational, not narrative.
- Cite every claim used. If two skeleton facts inform one sentence, cite both.

# Persona vocabulary

- TPM: timeline integrity, cross-team alignment, decision recency.
- Eng Manager: delivery risk, owner clarity, scope boundary.
- QA Lead: regression window, test depth, defect inflow.
- Security Lead: approval state, scope-change scrutiny, sign-off chain.
- Ops Manager: handoff readiness, change-management window, communication plan.

Render. Stop.""".strip()


# --- User-prompt builder ---------------------------------------------------


def build_renderer_user_prompt(
    skeleton: Skeleton,
    *,
    personas: list[str] | None = None,
) -> str:
    """Wrap the skeleton in tags + restate the output shape so smaller models
    don't drift into echoing the skeleton structure as output.

    personas: if None, the renderer chooses which personas to write a brief for
    based on what's in the skeleton. Caller can constrain by passing a list.
    """
    personas = personas or ["TPM", "Eng Manager", "QA Lead", "Security Lead", "Ops Manager"]
    sk_json = json.dumps(skeleton.to_dict(), ensure_ascii=False, separators=(",", ":"), default=str)
    persona_csv = ", ".join(personas)

    return f"""<skeleton>
{sk_json}
</skeleton>

Render per-persona briefs from the skeleton above. Write a brief for each of these personas only: {persona_csv}.

Cite claim_ids from skeleton.facts[].source_claim_ids and skeleton.conflicts[].candidates[].source_claim_ids only. Render every skeleton conflict as a conflict (both candidates surfaced, no winner).

Respond with EXACTLY this JSON object:

{{
  "briefs": [
    {{"persona":"<one of: {persona_csv}>","headline":"...","bullets":[{{"text":"...","claim_ids":[<int>,...]}}]}}
  ],
  "conflicts_rendered": [
    {{"conflict_id":<int>,"text":"...","claim_ids":[<int>,...]}}
  ]
}}

Do not include any other top-level keys. Do not echo the skeleton."""


# --- Output sanitiser ------------------------------------------------------


class RendererOutputError(ValueError):
    pass


def validate_renderer_output(
    payload: dict[str, Any],
    skeleton: Skeleton,
) -> dict[str, Any]:
    """Sanitiser: drop citations that aren't in the skeleton, drop bullets
    with no surviving citations, drop briefs with no surviving bullets,
    coerce types. Returns a copy.

    Raises RendererOutputError only on top-level shape failure.
    """
    if not isinstance(payload, dict):
        raise RendererOutputError("renderer output is not a JSON object")

    allowed_claim_ids = claim_ids_in(skeleton)
    allowed_conflict_ids = {c.finding_id for c in skeleton.conflicts}

    briefs_out: list[dict[str, Any]] = []
    conflicts_out: list[dict[str, Any]] = []
    dropped: dict[str, int] = {
        "briefs_no_bullets": 0,
        "bullets_no_cites": 0,
        "conflicts_unknown_id": 0,
        "conflicts_no_cites": 0,
    }

    # Briefs
    for b in payload.get("briefs", []) or []:
        if not isinstance(b, dict):
            dropped["briefs_no_bullets"] += 1
            continue
        bullets_valid: list[dict[str, Any]] = []
        for blt in b.get("bullets", []) or []:
            if not isinstance(blt, dict):
                dropped["bullets_no_cites"] += 1
                continue
            cids = [c for c in _coerce_int_list(blt.get("claim_ids")) if c in allowed_claim_ids]
            if not cids:
                dropped["bullets_no_cites"] += 1
                continue
            bullets_valid.append(
                {
                    "text": _coerce_str(blt.get("text"), maxlen=400),
                    "claim_ids": cids,
                }
            )
        if not bullets_valid:
            dropped["briefs_no_bullets"] += 1
            continue
        briefs_out.append(
            {
                "persona": _coerce_str(b.get("persona"), maxlen=64) or "TPM",
                "headline": _coerce_str(b.get("headline"), maxlen=200),
                "bullets": bullets_valid,
            }
        )

    # Conflicts rendered
    for r in payload.get("conflicts_rendered", []) or []:
        if not isinstance(r, dict):
            dropped["conflicts_unknown_id"] += 1
            continue
        try:
            cid = int(r.get("conflict_id"))
        except (TypeError, ValueError):
            dropped["conflicts_unknown_id"] += 1
            continue
        if cid not in allowed_conflict_ids:
            dropped["conflicts_unknown_id"] += 1
            continue
        cids = [c for c in _coerce_int_list(r.get("claim_ids")) if c in allowed_claim_ids]
        if not cids:
            dropped["conflicts_no_cites"] += 1
            continue
        conflicts_out.append(
            {
                "conflict_id": cid,
                "text": _coerce_str(r.get("text"), maxlen=400),
                "claim_ids": cids,
            }
        )

    return {
        "briefs": briefs_out,
        "conflicts_rendered": conflicts_out,
        "_dropped": dropped,
    }


# --- Deterministic fallback ------------------------------------------------


def template_fallback(skeleton: Skeleton) -> dict[str, Any]:
    """When the LLM renderer + NLI verifier persistently fail, fall back to a
    deterministic structured render: one brief per persona, headline summarises
    conflict count + blocker count, bullets are templated from facts and
    conflicts directly. Never lies, never picks sides.
    """
    bullets: list[dict[str, Any]] = []
    for c in skeleton.conflicts:
        cand_strs = [
            f"{(cand.value or cand.value_norm or 'unspecified')} (from {', '.join({s.source for s in cand.sources}) or 'unknown'})"
            for cand in c.candidates
        ]
        joined = "; ".join(cand_strs)
        all_cids: list[int] = []
        for cand in c.candidates:
            all_cids.extend(cand.source_claim_ids)
        bullets.append(
            {
                "text": (
                    f"Conflict on {c.kind} ({c.key}): {joined}. "
                    f"Both candidates remain on record."
                )[:400],
                "claim_ids": all_cids,
            }
        )

    for f in skeleton.facts[:5]:
        if f.value is None and f.value_norm is None:
            continue
        bullets.append(
            {
                "text": (
                    f"{f.kind} ({f.key}): {f.value or f.value_norm}."
                )[:400],
                "claim_ids": list(f.source_claim_ids),
            }
        )

    if not bullets:
        return {
            "briefs": [],
            "conflicts_rendered": [],
            "_fallback": True,
            "_dropped": {},
        }

    persona = "TPM"
    headline = (
        f"{len(skeleton.conflicts)} open conflict(s), "
        f"{len(skeleton.blockers_for_persona)} blocker(s) before the next sync"
    )[:200]

    conflicts_rendered = []
    for c in skeleton.conflicts:
        cand_strs = [
            f"{(cand.value or cand.value_norm or 'unspecified')}"
            for cand in c.candidates
        ]
        all_cids = []
        for cand in c.candidates:
            all_cids.extend(cand.source_claim_ids)
        conflicts_rendered.append(
            {
                "conflict_id": c.finding_id,
                "text": (
                    f"{c.kind} disagreement: {' vs '.join(cand_strs)}."
                )[:400],
                "claim_ids": all_cids,
            }
        )

    return {
        "briefs": [{"persona": persona, "headline": headline, "bullets": bullets}],
        "conflicts_rendered": conflicts_rendered,
        "_fallback": True,
        "_dropped": {},
    }


# --- helpers ---------------------------------------------------------------


def _coerce_int_list(v: Any) -> list[int]:
    if not isinstance(v, list):
        return []
    out: list[int] = []
    for x in v:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def _coerce_str(v: Any, *, maxlen: int) -> str:
    if not isinstance(v, str):
        return ""
    return v.strip()[:maxlen]
