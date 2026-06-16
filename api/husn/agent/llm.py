"""LLM client abstraction for the Step 6 agent.

Single Protocol — `LLMClient.complete(system, user, json_schema?)` — implemented
once per provider. Switching providers is `LLM_PROVIDER=ollama|groq|anthropic|...`
in .env. Same prompt, same JSON output, same anti-hallucination check.

Currently shipped:
  * OllamaClient   — local, free, default. Uses Ollama's OpenAI-compatible API.
  * GroqClient     — free cloud tier, fast. (Wired but untested until user provides key.)
  * AnthropicClient — best quality. (Wired but untested until user provides key.)

Each returns (raw_text, usage) where `usage` carries token counts if the
provider reports them.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Protocol

import httpx

from husn.core.config import get_settings
from husn.core.logging import log
from husn.usage import record_provider_limits


class RateLimitedError(Exception):
    """Provider rate-limited us (HTTP 429). The orchestrator catches this and
    skips the run cleanly instead of marking it `failed`, so the next cron
    tick gets a clean shot once the quota window rolls over."""

    def __init__(self, provider: str, retry_after_s: float | None) -> None:
        super().__init__(f"{provider} 429 (retry_after={retry_after_s})")
        self.provider = provider
        self.retry_after_s = retry_after_s


def _parse_retry_after(value: str | None) -> float | None:
    """Parse a `Retry-After` header into seconds.

    Supports both forms RFC 9110 permits: a number of seconds, or an HTTP-date
    (e.g. ``Wed, 21 Oct 2026 07:28:00 GMT``). Returns ``None`` when the header
    is absent or unparseable so the caller can fall back to a default backoff
    instead of giving up on the retry entirely.
    """
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        pass
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return max(0.0, (dt - datetime.now(timezone.utc)).total_seconds())


async def _post_with_429_retry(
    client: httpx.AsyncClient,
    *,
    provider: str,
    url: str,
    json: dict[str, Any],
    headers: dict[str, str] | None = None,
    max_attempts: int = 3,
    default_backoff_s: float = 2.0,
    max_backoff_s: float = 8.0,
) -> httpx.Response:
    """POST with short retries on HTTP 429, shared across every provider.

    On a 429 we read ``Retry-After`` (numeric or HTTP-date; a missing/garbled
    header falls back to ``default_backoff_s`` rather than bailing — that case
    is exactly per-minute throttling a short retry clears). If the wait is
    within ``max_backoff_s`` and attempts remain we sleep and retry; otherwise
    (a long daily-cap wait, or attempts exhausted) we raise ``RateLimitedError``
    so the orchestrator can skip cleanly. Non-429 errors raise via
    ``raise_for_status`` as before.
    """
    retry_after_s: float | None = None
    for attempt in range(max_attempts):
        r = await client.post(url, json=json, headers=headers)
        # Snapshot the provider's live rate-limit headers (real remaining quota)
        # on every response, including 429s. Best-effort.
        await record_provider_limits(provider, r.headers, r.status_code)
        if r.status_code != 429:
            r.raise_for_status()
            return r
        retry_after_s = _parse_retry_after(r.headers.get("retry-after"))
        wait = retry_after_s if retry_after_s is not None else default_backoff_s
        if wait > max_backoff_s:
            # Long wait (daily token cap) — don't park the run; skip cleanly.
            raise RateLimitedError(provider, retry_after_s)
        if attempt < max_attempts - 1:
            log.warning(
                "husn.llm.429_backoff",
                provider=provider,
                attempt=attempt + 1,
                retry_after_s=retry_after_s,
                wait_s=wait,
            )
            await asyncio.sleep(wait + 0.25)
    # Every attempt was a short-retryable 429 but we ran out of attempts.
    raise RateLimitedError(provider, retry_after_s)


@dataclass(slots=True)
class LLMResult:
    text: str
    input_tokens: int | None
    output_tokens: int | None
    raw: dict[str, Any]


class LLMClient(Protocol):
    provider: str
    model: str

    async def complete(
        self, *, system: str, user: str, json_mode: bool = True
    ) -> LLMResult: ...


# ---------------- Ollama --------------------------------------------------


class OllamaClient:
    provider = "ollama"

    def __init__(self) -> None:
        s = get_settings()
        self.base_url = s.ollama_base_url.rstrip("/")
        self.model = s.ollama_model
        self.timeout = s.llm_request_timeout_s

    async def complete(
        self, *, system: str, user: str, json_mode: bool = True
    ) -> LLMResult:
        """Use the /api/chat endpoint with format='json' to constrain output.

        Ollama supports an OpenAI-compatible endpoint at /v1/chat/completions
        but the native /api/chat with format='json' is more reliable for
        Qwen/Llama models at JSON-only output.
        """
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "options": {
                "temperature": 0.1,
                # Ollama's default context window is 2048 / 4096 depending on
                # the model — too small for a real dossier. 8K is the right
                # balance on a 24GB Mac running Qwen 7B + Docker: enough for
                # ~5-6K tokens of dossier + 1.5K system + 1.5K output, without
                # KV-cache memory pressure that thrashes swap.
                "num_ctx": 8192,
            },
        }
        if json_mode:
            body["format"] = "json"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await _post_with_429_retry(
                client,
                provider=self.provider,
                url=f"{self.base_url}/api/chat",
                json=body,
            )
            data = r.json()

        text = (data.get("message") or {}).get("content") or ""
        return LLMResult(
            text=text,
            input_tokens=data.get("prompt_eval_count"),
            output_tokens=data.get("eval_count"),
            raw=data,
        )


# ---------------- Groq (OpenAI-compatible) --------------------------------


class GroqClient:
    provider = "groq"

    def __init__(self) -> None:
        s = get_settings()
        self.api_key = s.groq_api_key
        self.model = s.groq_model
        self.timeout = s.llm_request_timeout_s
        self.base_url = "https://api.groq.com/openai/v1"

    async def complete(
        self, *, system: str, user: str, json_mode: bool = True
    ) -> LLMResult:
        if not self.api_key:
            raise RuntimeError("GROQ_API_KEY not configured")

        body: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.1,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}

        # Short retries on 429 (per-minute throttling); a long daily-cap
        # retry-after raises RateLimitedError so the orchestrator skips the run
        # cleanly rather than marking it failed. See _post_with_429_retry.
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await _post_with_429_retry(
                client,
                provider=self.provider,
                url=f"{self.base_url}/chat/completions",
                json=body,
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
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


# ---------------- Anthropic ------------------------------------------------


class AnthropicClient:
    provider = "anthropic"

    def __init__(self) -> None:
        s = get_settings()
        self.api_key = s.anthropic_api_key
        self.model = s.anthropic_model
        self.timeout = s.llm_request_timeout_s
        self.base_url = "https://api.anthropic.com/v1"

    async def complete(
        self, *, system: str, user: str, json_mode: bool = True
    ) -> LLMResult:
        if not self.api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not configured")

        # Anthropic doesn't have a literal "JSON mode" flag — we ask the
        # prompt to return only JSON and pre-fill the assistant turn with
        # an open brace to discourage prose preamble.
        messages: list[dict[str, str]] = [{"role": "user", "content": user}]
        if json_mode:
            messages.append({"role": "assistant", "content": "{"})

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await _post_with_429_retry(
                client,
                provider=self.provider,
                url=f"{self.base_url}/messages",
                json={
                    "model": self.model,
                    "system": system,
                    "messages": messages,
                    "max_tokens": 4096,
                    "temperature": 0.1,
                },
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
            )
            data = r.json()

        parts = data.get("content") or []
        text = "".join(p.get("text", "") for p in parts if p.get("type") == "text")
        if json_mode and not text.startswith("{"):
            text = "{" + text  # re-attach the prefill brace
        usage = data.get("usage") or {}
        return LLMResult(
            text=text,
            input_tokens=usage.get("input_tokens"),
            output_tokens=usage.get("output_tokens"),
            raw=data,
        )


# ---------------- Factory --------------------------------------------------


def get_llm_client() -> LLMClient:
    provider = get_settings().llm_provider
    if provider == "ollama":
        return OllamaClient()
    if provider == "groq":
        return GroqClient()
    if provider == "anthropic":
        return AnthropicClient()
    raise ValueError(f"unknown LLM_PROVIDER: {provider}")


def parse_json_response(text: str) -> dict[str, Any]:
    """Try hard to extract JSON from a model response. Strips Markdown code
    fences and leading/trailing junk before failing.
    """
    text = text.strip()
    if text.startswith("```"):
        # ```json\n{...}\n```
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[: -3]
        text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Find the first { and last } as a best-effort fix
        first = text.find("{")
        last = text.rfind("}")
        if first >= 0 and last > first:
            return json.loads(text[first : last + 1])
        raise
