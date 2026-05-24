"""Prompts + JSON schema + post-LLM validator for the Step 6 agent.

System prompt encodes the husn.io product contract:
  1. Output is JSON only. No prose, no preamble, no markdown.
  2. Every claim cited in findings/briefs/recommendations MUST be a claim_id
     from the input dossier. Anti-hallucination rule #1.
  3. NEVER name an individual person as accountable / responsive / behind.
     Findings and briefs reference TEAMS, ARTIFACTS, and CLAIMS — not people.
     Anti-monitoring guardrail per knowledge.md §6 + EU AI Act Annex III.
  4. Distinguish binding statements from speculation / questions.
"""

import json
from typing import Any

from husn.agent.context import valid_artifact_ids, valid_claim_ids

PROMPT_VERSION = 1

SYSTEM_PROMPT = """You are husn.io — an operational coordination agent for a Technical Program Manager.

You read a project dossier (artifacts from Jira / Slack / Gmail / Drive plus extracted claims and current open findings) and produce a JSON object with three keys: findings, briefs, recommendations.

# Output contract (STRICT)

Output JSON only. No markdown, no prose, no preamble. The top-level shape is:

{
  "findings": [
    {
      "rule_id": "AGENT-FINDING-<short_slug>",
      "summary": "one-sentence description (≤140 chars)",
      "severity": "low" | "medium" | "high",
      "claim_ids": [<int>, ...]            // every id MUST exist in dossier.claims
    }
  ],
  "briefs": [
    {
      "persona": "TPM" | "Eng Manager" | "QA Lead" | "Security Lead" | "Ops Manager",
      "headline": "one-sentence summary (≤140 chars)",
      "bullets": [
        {
          "text": "one operational sentence",
          "claim_ids": [<int>, ...]        // every bullet MUST cite ≥1 claim_id from dossier.claims
        }
      ]
    }
  ],
  "recommendations": [
    {
      "text": "one actionable suggestion (≤200 chars)",
      "claim_ids": [<int>, ...],
      "audience": "Project" | "TPM" | "Eng Manager" | "QA Lead" | "Security Lead" | "Ops Manager"
    }
  ]
}

If you have nothing for a section, return an empty array. Do not invent placeholder text.

# Anti-hallucination rules (NON-NEGOTIABLE)

1. Every integer in `claim_ids` MUST be the `id` of a claim in `dossier.claims`. If you can't cite an existing claim_id, do not include the finding/brief/recommendation.
2. Every persona in briefs MUST be one of the listed enum values.
3. Do not reference dates, statuses, or owners that aren't present in `dossier.claims` or `dossier.artifacts`.

# Anti-monitoring guardrails (NON-NEGOTIABLE)

1. NEVER write that a named individual is "behind", "unresponsive", "slow to reply", "not engaged", or otherwise score them as people. Reference TEAMS and ARTIFACTS instead.
2. NEVER produce per-person leaderboards or rankings.
3. When an acknowledgment is missing, say "no recorded acknowledgement from <team>" — not "<person> did not respond".
4. Findings and recommendations describe STATE OF WORK and SOURCE CONFLICT, not employee performance.

# How to reason

1. Read `claim_groups` first — each group is a logical fact (e.g. "release date"). Within a group, multiple distinct `value_norm` values = drift.
2. For drift findings: prefer the NEWEST source claim as the likely truth. Treat older claims as superseded UNLESS they came from a binding doc-of-record (e.g. a Steering Committee Status Pack).
3. Distinguish RECORDED COMMITMENTS (Jira fields, Confluence pages, Cutover Runbook) from CHAT DISCUSSION. A binding date in Jira disagreeing with a casual Slack message: "drift, source-of-record says X". Two Slack messages disagreeing: "discussion, no clear truth yet, needs alignment".
4. Briefs are written for the persona's interests — Eng Manager cares about delivery risk, QA Lead cares about regression windows, Security cares about approvals + scope changes.
5. Briefs are scoped to the recipient's domain. Never tell a persona about a different persona's behavior.

# Example claim_id citation

If dossier.claims contains:
  { "id": 7, "kind": "date", "key": "launch", "value_norm": "2026-06-10", "source_anchor": {"snippet": "launch has shifted to June 10..."} }
  { "id": 31, "kind": "date", "key": "target", "value_norm": "2026-06-03", "source_anchor": {"snippet": "Target GA is June 3..."} }

Then a valid finding is:
  { "rule_id": "AGENT-FINDING-release-date-drift", "summary": "Release date conflict: Slack says June 10, doc says June 3", "severity": "high", "claim_ids": [7, 31] }

`claim_ids: [7, 31]` is valid because both 7 and 31 are real claim ids in the dossier.
""".strip()


def build_user_prompt(dossier: dict[str, Any]) -> str:
    """User prompt explicitly wraps the dossier in tags so smaller models
    don't confuse it with the output schema, and re-states the output shape
    at the bottom so it's the last thing the model reads before generating.
    """
    dossier_json = json.dumps(dossier, ensure_ascii=False, separators=(",", ":"), default=str)
    return f"""<dossier>
{dossier_json}
</dossier>

Read <dossier> above. Identify cross-source drift, write per-persona pre-meeting briefs, and propose recommendations. Cite claim ids from dossier.claims only.

Respond with ONE JSON object exactly matching this shape:

{{
  "findings": [{{"rule_id":"AGENT-FINDING-...","summary":"...","severity":"low|medium|high","claim_ids":[<int>,...]}}],
  "briefs":   [{{"persona":"TPM|Eng Manager|QA Lead|Security Lead|Ops Manager","headline":"...","bullets":[{{"text":"...","claim_ids":[<int>,...]}}]}}],
  "recommendations": [{{"text":"...","claim_ids":[<int>,...],"audience":"Project|TPM|Eng Manager|QA Lead|Security Lead|Ops Manager"}}]
}}

Do not return the dossier. Do not include any other top-level keys. Output ONLY the JSON object with keys `findings`, `briefs`, `recommendations`."""


# ---------------- Validator -----------------------------------------------


class AgentOutputError(ValueError):
    pass


def validate_agent_output(payload: dict[str, Any], dossier: dict[str, Any]) -> dict[str, Any]:
    """Walks the agent's JSON output and rejects any citation that isn't in
    the dossier. Returns a SANITIZED copy of payload — drops invalid items
    rather than failing the whole run, so a single bad citation doesn't lose
    a useful finding.

    Raises AgentOutputError only if the top-level shape is wrong.
    """
    if not isinstance(payload, dict):
        raise AgentOutputError("agent output is not a JSON object")

    claim_ids_ok = valid_claim_ids(dossier)
    findings_out: list[dict[str, Any]] = []
    briefs_out: list[dict[str, Any]] = []
    recs_out: list[dict[str, Any]] = []
    dropped: dict[str, int] = {"findings": 0, "briefs": 0, "bullets": 0, "recommendations": 0}

    for f in payload.get("findings", []) or []:
        if not isinstance(f, dict):
            dropped["findings"] += 1
            continue
        cids = _coerce_int_list(f.get("claim_ids"))
        valid = [c for c in cids if c in claim_ids_ok]
        if not valid:
            dropped["findings"] += 1
            continue
        findings_out.append(
            {
                "rule_id": _coerce_rule_id(f.get("rule_id")),
                "summary": _coerce_str(f.get("summary"), maxlen=200),
                "severity": _coerce_enum(
                    f.get("severity"), {"low", "medium", "high"}, default="medium"
                ),
                "claim_ids": valid,
            }
        )

    for b in payload.get("briefs", []) or []:
        if not isinstance(b, dict):
            dropped["briefs"] += 1
            continue
        bullets_valid: list[dict[str, Any]] = []
        for blt in b.get("bullets", []) or []:
            if not isinstance(blt, dict):
                dropped["bullets"] += 1
                continue
            cids = [c for c in _coerce_int_list(blt.get("claim_ids")) if c in claim_ids_ok]
            if not cids:
                dropped["bullets"] += 1
                continue
            bullets_valid.append(
                {"text": _coerce_str(blt.get("text"), maxlen=400), "claim_ids": cids}
            )
        if not bullets_valid:
            dropped["briefs"] += 1
            continue
        briefs_out.append(
            {
                "persona": _coerce_str(b.get("persona"), maxlen=64) or "TPM",
                "headline": _coerce_str(b.get("headline"), maxlen=200),
                "bullets": bullets_valid,
            }
        )

    for r in payload.get("recommendations", []) or []:
        if not isinstance(r, dict):
            dropped["recommendations"] += 1
            continue
        cids = [c for c in _coerce_int_list(r.get("claim_ids")) if c in claim_ids_ok]
        if not cids:
            dropped["recommendations"] += 1
            continue
        recs_out.append(
            {
                "text": _coerce_str(r.get("text"), maxlen=300),
                "claim_ids": cids,
                "audience": _coerce_str(r.get("audience"), maxlen=64) or "Project",
            }
        )

    return {
        "findings": findings_out,
        "briefs": briefs_out,
        "recommendations": recs_out,
        "_dropped": dropped,
    }


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


def _coerce_enum(v: Any, allowed: set[str], *, default: str) -> str:
    if isinstance(v, str) and v in allowed:
        return v
    return default


def _coerce_rule_id(v: Any) -> str:
    s = _coerce_str(v, maxlen=64)
    if not s:
        return "AGENT-FINDING-unspecified"
    if not s.startswith("AGENT-FINDING-"):
        s = "AGENT-FINDING-" + s
    return s[:64]
