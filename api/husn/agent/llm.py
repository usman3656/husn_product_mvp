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

import json
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from husn.core.config import get_settings


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
            r = await client.post(f"{self.base_url}/api/chat", json=body)
            r.raise_for_status()
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

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(
                f"{self.base_url}/chat/completions",
                json=body,
                headers={"Authorization": f"Bearer {self.api_key}"},
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
            r = await client.post(
                f"{self.base_url}/messages",
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
            r.raise_for_status()
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
