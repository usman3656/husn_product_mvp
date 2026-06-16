/**
 * Shared chat types + client helpers.
 *
 * Both the full-page Ask Husn surface (components/ask-husn-shell.tsx) and the
 * global popup (components/chat-widget.tsx) talk to the same per-user chat API
 * (api/husn/routers/chat.py). Keep these shapes in one place so the two
 * surfaces never drift.
 */

import { clientFetch } from "@/lib/api";

/** Turn a failed Response into a clean, human sentence.
 *
 * The API returns FastAPI's {"detail": "..."} on error (already user-safe — it
 * never contains a provider URL or exception type). Parse that; fall back to a
 * generic line so we never render a raw JSON blob or stack string in the UI. */
export async function describeError(r: Response): Promise<string> {
  try {
    const body = (await r.json()) as { detail?: unknown };
    if (body?.detail) return String(body.detail);
  } catch {
    /* non-JSON body — fall through */
  }
  if (r.status === 429) return "Rate-limited right now — please try again in a moment.";
  return "Something went wrong — please try again.";
}

export type SessionSummary = {
  id: number;
  project_id: number | null;
  title: string;
  created_at: string;
  updated_at: string;
};

export type ChatMessage = {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  cited_claim_ids: number[];
  cited_artifact_ids: number[];
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
};

export async function listSessions(): Promise<SessionSummary[]> {
  const r = await clientFetch("/api/chat/sessions");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = (await r.json()) as { items: SessionSummary[] };
  return body.items;
}

export async function createSession(): Promise<number> {
  const r = await clientFetch("/api/chat/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = (await r.json()) as { id: number };
  return body.id;
}

export async function deleteSession(id: number): Promise<void> {
  const r = await clientFetch(`/api/chat/sessions/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

export async function listMessages(sessionId: number): Promise<ChatMessage[]> {
  const r = await clientFetch(`/api/chat/sessions/${sessionId}/messages`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = (await r.json()) as { items: ChatMessage[] };
  return body.items;
}

/** Send a user turn; the server persists it, runs the agent, and returns the
 *  assistant turn. Callers re-fetch the thread to pick up both turns. */
export async function sendMessage(sessionId: number, content: string): Promise<void> {
  const r = await clientFetch(`/api/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!r.ok) {
    // FastAPI returns {"detail": "..."} on error — surface that, not raw JSON.
    let detail = `HTTP ${r.status}`;
    try {
      const body = (await r.json()) as { detail?: unknown };
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* non-JSON body — keep the status line */
    }
    throw new Error(detail);
  }
}
