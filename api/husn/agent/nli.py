"""NLI verifier for the Step 5/6 v2 brief renderer.

Every sentence the renderer emits cites one or more `claim_ids` from the
skeleton. For each (sentence, cited_claim) pair we ask the LLM, JSON-mode,
whether the source snippet of that claim entails the sentence. If any cited
pair fails, the bullet is rejected. The caller (the brief orchestrator) then
either retries the renderer or falls back to the deterministic template.

Set-membership ("every cited claim_id is in the skeleton") is enforced
elsewhere; this module enforces the harder property: the rendered sentence
must be a faithful paraphrase of *something the source actually says*.

This module knows nothing about retries, persistence, fallback prose. It is a
pure verifier over (skeleton, rendered output) → NLIResult.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from husn.agent.llm import LLMClient
from husn.agent.skeleton import Skeleton
from husn.core.logging import log


_SYSTEM_PROMPT = (
    "You are a strict faithfulness checker. Given a SOURCE SNIPPET and a SENTENCE, "
    "decide whether the snippet ENTAILS the sentence — that is, whether a careful "
    "reader could derive the sentence from the snippet alone, without adding outside "
    "knowledge, without resolving pronouns to entities not named in the snippet, "
    "and without softening or strengthening claims. "
    "Dates and numbers must match exactly. "
    "If the sentence introduces an attribution, action, or modifier not literally "
    "present in the snippet, the answer is no. "
    "Respond with JSON only: "
    '{"entails": true|false, "reason": "<one short clause>"}'
)


@dataclass(slots=True)
class SentenceCheck:
    """One (sentence, cited_claim_id) verification result."""

    sentence: str
    claim_id: int
    entails: bool
    reason: str


@dataclass(slots=True)
class BulletCheck:
    """One bullet's combined verification. Passes only if every cited
    (sentence, claim) pair entailed.
    """

    bullet_index: int
    text: str
    cited_claim_ids: list[int]
    passed: bool
    sentence_checks: list[SentenceCheck] = field(default_factory=list)


@dataclass(slots=True)
class NLIResult:
    """Aggregate verifier output."""

    ok: bool
    bullet_checks: list[BulletCheck]
    failed_bullets: list[int]  # indices into bullet_checks
    sentences_checked: int

    @property
    def fail_count(self) -> int:
        return sum(1 for bc in self.bullet_checks if not bc.passed)


# ---------- Public API ----------


async def verify_bullets(
    *,
    bullets: list[dict[str, Any]],
    skeleton: Skeleton,
    llm: LLMClient,
) -> NLIResult:
    """Verify every bullet's cited claims against the skeleton's source snippets.

    `bullets` is the renderer's output list: `[{"text": "...", "claim_ids": [...]}, ...]`.
    A bullet passes only if every cited claim entails the bullet text.

    Set-membership errors (claim_id not present in the skeleton) count as a
    fail without an LLM call — they would have been caught upstream too, but
    we guard here so the verifier never sends garbage to the LLM.
    """
    snippets = _claim_snippets(skeleton)
    bullet_checks: list[BulletCheck] = []

    for i, b in enumerate(bullets):
        text = (b.get("text") or "").strip()
        cited_ids: list[int] = [int(x) for x in (b.get("claim_ids") or [])]

        if not text or not cited_ids:
            bullet_checks.append(
                BulletCheck(
                    bullet_index=i,
                    text=text,
                    cited_claim_ids=cited_ids,
                    passed=False,
                    sentence_checks=[
                        SentenceCheck(
                            sentence=text,
                            claim_id=0,
                            entails=False,
                            reason="missing text or claim citations",
                        )
                    ],
                )
            )
            continue

        sentence_checks: list[SentenceCheck] = []
        for cid in cited_ids:
            snippet = snippets.get(cid)
            if snippet is None:
                sentence_checks.append(
                    SentenceCheck(
                        sentence=text,
                        claim_id=cid,
                        entails=False,
                        reason=f"claim {cid} not in skeleton",
                    )
                )
                continue

            sentence_checks.append(
                await _check_one(sentence=text, snippet=snippet, claim_id=cid, llm=llm)
            )

        passed = all(sc.entails for sc in sentence_checks)
        bullet_checks.append(
            BulletCheck(
                bullet_index=i,
                text=text,
                cited_claim_ids=cited_ids,
                passed=passed,
                sentence_checks=sentence_checks,
            )
        )

    failed = [bc.bullet_index for bc in bullet_checks if not bc.passed]
    sentences_checked = sum(len(bc.sentence_checks) for bc in bullet_checks)

    result = NLIResult(
        ok=(len(failed) == 0),
        bullet_checks=bullet_checks,
        failed_bullets=failed,
        sentences_checked=sentences_checked,
    )

    log.info(
        "nli_verify",
        ok=result.ok,
        bullets=len(bullet_checks),
        failed=len(failed),
        sentences_checked=sentences_checked,
    )
    return result


# ---------- Internals ----------


def _claim_snippets(skeleton: Skeleton) -> dict[int, str]:
    """Walk the skeleton and gather a (claim_id → snippet text) map. We prefer
    the explicit snippet recorded in source_anchor; if none, fall back to the
    claim's normalized value.
    """
    out: dict[int, str] = {}
    for f in skeleton.facts:
        for src in f.sources:
            out[src.claim_id] = _snippet_for(src.source_anchor, src.value, src.value_norm)
    for c in skeleton.conflicts:
        for cand in c.candidates:
            for src in cand.sources:
                out[src.claim_id] = _snippet_for(
                    src.source_anchor, src.value, src.value_norm
                )
    return out


def _snippet_for(
    source_anchor: dict[str, Any],
    value: str | None,
    value_norm: str | None,
) -> str:
    """Get the verbatim source snippet for a claim.

    Anchor shapes per husn.db.models.Claim:
      {"kind": "field", "artifact_id": ..., "field_path": "fields.duedate"}
      {"kind": "span",  "artifact_id": ..., "char_start": .., "char_end": .., "snippet": "..."}
    """
    snip = (source_anchor or {}).get("snippet")
    if snip:
        return str(snip).strip()
    if value:
        return str(value).strip()
    if value_norm:
        return str(value_norm).strip()
    return ""


async def _check_one(
    *,
    sentence: str,
    snippet: str,
    claim_id: int,
    llm: LLMClient,
) -> SentenceCheck:
    """One (sentence, snippet) → entailment yes/no via the LLM.

    Defaults to entails=False on any parse error so a verifier failure can
    never let a bad bullet through.
    """
    user = f"SOURCE SNIPPET:\n{snippet}\n\nSENTENCE:\n{sentence}"
    try:
        result = await llm.complete(system=_SYSTEM_PROMPT, user=user, json_mode=True)
        parsed = json.loads(result.text)
        entails = bool(parsed.get("entails", False))
        reason = str(parsed.get("reason", ""))[:280]
        return SentenceCheck(
            sentence=sentence,
            claim_id=claim_id,
            entails=entails,
            reason=reason,
        )
    except json.JSONDecodeError as e:
        log.warning("nli_parse_error", claim_id=claim_id, err=str(e))
        return SentenceCheck(
            sentence=sentence,
            claim_id=claim_id,
            entails=False,
            reason=f"verifier parse error: {e}",
        )
    except Exception as e:  # noqa: BLE001 — verifier must never raise into caller
        log.warning("nli_llm_error", claim_id=claim_id, err=str(e))
        return SentenceCheck(
            sentence=sentence,
            claim_id=claim_id,
            entails=False,
            reason=f"verifier llm error: {e}",
        )
