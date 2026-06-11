"use client";

import { useEffect, useRef, useState } from "react";

import { EvidenceChip, LoadingState, OfflineState, Pill } from "@/components/ui";
import { clientFetch } from "@/lib/api";

type SessionSummary = {
  id: number;
  project_id: number | null;
  title: string;
  created_at: string;
  updated_at: string;
};

type Message = {
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

const SUGGESTIONS = [
  "What's the current status of the launch date for Project Atlas?",
  "Why did you flag the security approval finding?",
  "Did anyone mention QA regression concerns in Slack?",
  "Draft a steerco update for this week.",
  "What's the biggest risk to the launch right now?",
];

export function ChatRoom() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Initial sessions load + auto-open the most recent or create a new one
  useEffect(() => {
    (async () => {
      try {
        const r = await clientFetch("/api/chat/sessions");
        const body = (await r.json()) as { items: SessionSummary[] };
        setSessions(body.items);
        if (body.items.length > 0) {
          setCurrentId(body.items[0].id);
        } else {
          await createSession(true);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "load failed");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (currentId == null) {
      setMessages([]);
      return;
    }
    (async () => {
      try {
        const r = await clientFetch(`/api/chat/sessions/${currentId}/messages`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = (await r.json()) as { items: Message[] };
        setMessages(body.items);
      } catch (e) {
        setError(e instanceof Error ? e.message : "load failed");
      }
    })();
  }, [currentId]);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages, sending]);

  async function refreshSessions() {
    const r = await clientFetch("/api/chat/sessions");
    const body = (await r.json()) as { items: SessionSummary[] };
    setSessions(body.items);
  }

  async function createSession(autoSelect: boolean) {
    const r = await clientFetch("/api/chat/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = (await r.json()) as { id: number };
    await refreshSessions();
    if (autoSelect) setCurrentId(body.id);
  }

  async function deleteSession(id: number) {
    if (!confirm("Delete this conversation?")) return;
    await clientFetch(`/api/chat/sessions/${id}`, { method: "DELETE" });
    if (currentId === id) setCurrentId(null);
    await refreshSessions();
  }

  async function send(content: string) {
    const text = content.trim();
    if (!text || currentId == null) return;

    setSending(true);
    setError(null);
    // Optimistic user-turn so the textarea clears instantly
    const optimistic: Message = {
      id: -Date.now(),
      role: "user",
      content: text,
      cited_claim_ids: [],
      cited_artifact_ids: [],
      model: null,
      input_tokens: null,
      output_tokens: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    try {
      const r = await clientFetch(
        `/api/chat/sessions/${currentId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
        },
      );
      if (!r.ok) {
        const body = await r.text();
        throw new Error(body.slice(0, 200));
      }
      // Re-fetch to get the real ids for both user + assistant turns
      const list = await (
        await clientFetch(`/api/chat/sessions/${currentId}/messages`)
      ).json();
      setMessages(list.items);
      await refreshSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "send failed");
      // Roll back the optimistic message
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading your conversations" />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
      {/* Session sidebar */}
      <aside
        className="rounded-[var(--radius)] border p-3"
        style={{ borderColor: "var(--border)", background: "var(--panel)", boxShadow: "var(--shadow-sm)" }}
      >
        <button
          onClick={() => createSession(true)}
          className="w-full rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors duration-150"
          style={{ borderColor: "var(--border-strong)", color: "var(--text)", background: "var(--panel)" }}
        >
          New conversation
        </button>
        {sessions.length === 0 ? (
          <p className="mt-3 text-[12px]" style={{ color: "var(--muted)" }}>
            No conversations yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-1">
            {sessions.map((s) => {
              const active = s.id === currentId;
              return (
                <li
                  key={s.id}
                  className="group flex items-center justify-between rounded-[var(--radius-sm)] px-2.5 py-2 text-[13px]"
                  style={{
                    background: active ? "var(--accent-soft)" : "transparent",
                    color: active ? "var(--text)" : "var(--muted)",
                  }}
                >
                  <button
                    onClick={() => setCurrentId(s.id)}
                    className="flex-1 truncate text-left"
                    title={s.title}
                  >
                    {s.title}
                  </button>
                  <button
                    onClick={() => deleteSession(s.id)}
                    title="Delete conversation"
                    aria-label="Delete conversation"
                    className="ml-2 text-[12px] opacity-0 group-hover:opacity-100"
                    style={{ color: "var(--muted)" }}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* Conversation pane */}
      <section
        className="flex h-[70vh] flex-col rounded-[var(--radius)] border"
        style={{ borderColor: "var(--border)", background: "var(--panel)", boxShadow: "var(--shadow-sm)" }}
      >
        <div
          ref={scrollerRef}
          className="flex-1 overflow-y-auto p-4"
          style={{ scrollBehavior: "smooth" }}
        >
          {messages.length === 0 ? (
            <EmptyChat onPick={send} disabled={sending} />
          ) : (
            <ul className="space-y-3">
              {messages.map((m) => (
                <MessageRow key={m.id} message={m} />
              ))}
              {sending && (
                <li className="text-[12px]" style={{ color: "var(--muted)" }}>
                  Thinking…
                </li>
              )}
            </ul>
          )}
        </div>

        {error && (
          <div className="border-t px-4 py-3" style={{ borderColor: "var(--border)" }}>
            <OfflineState title="That message could not send" hint={error} />
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2 border-t p-3"
          style={{ borderColor: "var(--border)" }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask anything about your program (Enter to send, Shift+Enter for a new line)"
            className="flex-1 resize-none rounded-[var(--radius-sm)] border bg-transparent px-3 py-2 text-[13px]"
            style={{ borderColor: "var(--border)", color: "var(--text)", minHeight: "44px", maxHeight: "160px" }}
            rows={1}
            disabled={sending || currentId == null}
          />
          <button
            type="submit"
            disabled={sending || !input.trim() || currentId == null}
            className="rounded-full border px-4 py-2 text-[13px] font-medium transition-colors duration-150 disabled:opacity-50"
            style={{ borderColor: "var(--accent)", color: "var(--on-accent)", background: "var(--accent)" }}
          >
            Send
          </button>
        </form>
      </section>
    </div>
  );
}

function MessageRow({ message }: { message: Message }) {
  const isUser = message.role === "user";
  // Hide model/token telemetry in the demo snapshot (and it never shows for users).
  const showTelemetry = !isUser && message.model;
  return (
    <li
      className="rounded-[var(--radius-sm)] border p-3.5"
      style={{
        borderColor: isUser ? "var(--border)" : "var(--accent-line)",
        background: isUser ? "var(--panel-2)" : "var(--accent-soft)",
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <Pill tone={isUser ? "neutral" : "accent"}>{isUser ? "You" : "Husn"}</Pill>
        {showTelemetry && (
          <span className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>
            {message.model} · {message.input_tokens}→{message.output_tokens} tok
          </span>
        )}
      </div>
      <div className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">
        <CitedText text={message.content} />
      </div>
      {!isUser &&
        (message.cited_claim_ids.length > 0 ||
          message.cited_artifact_ids.length > 0) && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {message.cited_claim_ids.map((id) => (
              <EvidenceChip key={`c${id}`} source="Fact" cite={`#${id}`} tone="accent" />
            ))}
            {message.cited_artifact_ids.map((id) => (
              <EvidenceChip key={`a${id}`} source="Source" cite={`#${id}`} tone="success" />
            ))}
          </div>
        )}
    </li>
  );
}

/** Render text with `[claim N]` / `[artifact N]` / `[finding N]` highlighted. */
function CitedText({ text }: { text: string }) {
  const parts: (string | { kind: string; id: number; raw: string })[] = [];
  const re = /\[(claim|artifact|finding)\s+(\d+)\]/gi;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    parts.push({ kind: m[1].toLowerCase(), id: Number(m[2]), raw: m[0] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));

  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <span
            key={i}
            className="rounded px-1 font-mono text-[11px]"
            style={{
              background:
                p.kind === "claim"
                  ? "var(--accent-soft)"
                  : p.kind === "artifact"
                    ? "var(--success-soft)"
                    : "var(--warning-soft)",
              color:
                p.kind === "claim"
                  ? "var(--accent-ink)"
                  : p.kind === "artifact"
                    ? "var(--success-ink)"
                    : "var(--warning-ink)",
            }}
            title={`Cited ${p.kind} #${p.id}`}
          >
            {p.raw}
          </span>
        ),
      )}
    </>
  );
}

function EmptyChat({
  onPick,
  disabled,
}: {
  onPick: (q: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <div className="text-center">
        <p className="text-[15px] font-medium">Ask about your program</p>
        <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
          Try one of these to get started.
        </p>
      </div>
      <ul className="w-full max-w-md space-y-2">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              disabled={disabled}
              onClick={() => onPick(s)}
              className="w-full rounded-[var(--radius-sm)] border px-3.5 py-2.5 text-left text-[13px] transition-colors duration-150 hover:bg-[var(--panel-2)] disabled:opacity-50"
              style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--panel)" }}
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
