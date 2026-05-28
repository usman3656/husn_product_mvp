"use client";

import { useEffect, useRef, useState } from "react";

import { DEMO_MODE } from "@/lib/demo";

const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

// Baked transcript for the read-only GitHub Pages snapshot — real Q&A captured
// against the live Project Atlas graph. No backend in the static build.
const DEMO_SESSIONS: SessionSummary[] = [
  {
    id: 1,
    project_id: 1,
    title: "Project Atlas — launch readiness",
    created_at: "2026-05-20T14:02:00Z",
    updated_at: "2026-05-20T14:09:00Z",
  },
];

const DEMO_MESSAGES: Message[] = [
  {
    id: 1,
    role: "user",
    content: "What's the current status of the launch date for Project Atlas?",
    cited_claim_ids: [],
    cited_artifact_ids: [],
    model: null,
    input_tokens: null,
    output_tokens: null,
    created_at: "2026-05-20T14:02:00Z",
  },
  {
    id: 2,
    role: "assistant",
    content:
      "The launch date is in conflict across sources. Jira epic ATLAS-204 lists the target as June 10 [claim 43], but the latest steerco deck in Drive (\"Atlas Launch Plan v3\") still says June 3 [claim 51], and a Slack thread in #atlas-launch on May 18 has the eng lead saying \"we're holding June 10, the deck is stale\" [artifact 109]. So the operative date is June 10 — the deck is the outdated source and hasn't been updated. I've flagged this as an unresolved drift [finding 12] because no one has corrected the deck and Finance is still planning against June 3.",
    cited_claim_ids: [43, 51],
    cited_artifact_ids: [109],
    model: "llama-3.3-70b-versatile",
    input_tokens: 4180,
    output_tokens: 142,
    created_at: "2026-05-20T14:02:30Z",
  },
  {
    id: 3,
    role: "user",
    content: "What's the biggest risk to the launch right now?",
    cited_claim_ids: [],
    cited_artifact_ids: [],
    model: null,
    input_tokens: null,
    output_tokens: null,
    created_at: "2026-05-20T14:08:00Z",
  },
  {
    id: 4,
    role: "assistant",
    content:
      "Security sign-off. The launch checklist in Confluence marks \"Security review: approved\" [claim 67], but the actual approval thread in #security-review shows the reviewer asked for a re-scan after the auth change on May 15 and never gave final sign-off [artifact 122]. That's the highest-severity open finding [finding 9]: a checklist claims done, the evidence says pending. If you launch June 10 on the current checklist, you'd be shipping against an unapproved security review. Recommend confirming with the named reviewer before steerco signs off.",
    cited_claim_ids: [67],
    cited_artifact_ids: [122],
    model: "llama-3.3-70b-versatile",
    input_tokens: 4320,
    output_tokens: 138,
    created_at: "2026-05-20T14:08:40Z",
  },
];

export function ChatRoom() {
  const [sessions, setSessions] = useState<SessionSummary[]>(
    DEMO_MODE ? DEMO_SESSIONS : [],
  );
  const [currentId, setCurrentId] = useState<number | null>(
    DEMO_MODE ? 1 : null,
  );
  const [messages, setMessages] = useState<Message[]>(
    DEMO_MODE ? DEMO_MESSAGES : [],
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!DEMO_MODE);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Initial sessions load + auto-open the most recent or create a new one
  useEffect(() => {
    if (DEMO_MODE) return;
    (async () => {
      try {
        const r = await fetch(`${BROWSER_API_URL}/api/chat/sessions`);
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
    if (DEMO_MODE) return;
    if (currentId == null) {
      setMessages([]);
      return;
    }
    (async () => {
      try {
        const r = await fetch(`${BROWSER_API_URL}/api/chat/sessions/${currentId}/messages`);
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
    const r = await fetch(`${BROWSER_API_URL}/api/chat/sessions`);
    const body = (await r.json()) as { items: SessionSummary[] };
    setSessions(body.items);
  }

  async function createSession(autoSelect: boolean) {
    const r = await fetch(`${BROWSER_API_URL}/api/chat/sessions`, {
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
    await fetch(`${BROWSER_API_URL}/api/chat/sessions/${id}`, { method: "DELETE" });
    if (currentId === id) setCurrentId(null);
    await refreshSessions();
  }

  async function send(content: string) {
    const text = content.trim();
    if (!text || currentId == null) return;

    // No backend in the static demo — echo the question and a canned note.
    if (DEMO_MODE) {
      const now = new Date().toISOString();
      setMessages((prev) => [
        ...prev,
        {
          id: -Date.now(),
          role: "user",
          content: text,
          cited_claim_ids: [],
          cited_artifact_ids: [],
          model: null,
          input_tokens: null,
          output_tokens: null,
          created_at: now,
        },
        {
          id: -Date.now() - 1,
          role: "assistant",
          content:
            "This is a static snapshot of husn.io for demo purposes — the live agent isn't running here. In the full product this answer is generated against the operational graph with grounded citations to claims, artifacts, and findings, exactly like the transcript above.",
          cited_claim_ids: [],
          cited_artifact_ids: [],
          model: "demo",
          input_tokens: null,
          output_tokens: null,
          created_at: now,
        },
      ]);
      setInput("");
      return;
    }

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
      const r = await fetch(
        `${BROWSER_API_URL}/api/chat/sessions/${currentId}/messages`,
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
        await fetch(`${BROWSER_API_URL}/api/chat/sessions/${currentId}/messages`)
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

  function timeAgo(iso: string): string {
    const t = new Date(iso).getTime();
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  }

  if (loading) {
    return (
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Loading…
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
      {/* Session sidebar */}
      <aside
        className="rounded-lg border p-3"
        style={{ borderColor: "var(--border)", background: "var(--panel)" }}
      >
        <button
          onClick={() => createSession(true)}
          className="w-full rounded border px-3 py-1.5 text-xs font-medium"
          style={{ borderColor: "var(--border)", color: "var(--text)", background: "#1a1f2c" }}
        >
          + New conversation
        </button>
        <ul className="mt-3 space-y-1">
          {sessions.map((s) => (
            <li
              key={s.id}
              className={`group flex items-center justify-between rounded px-2 py-1.5 text-xs ${s.id === currentId ? "" : "cursor-pointer"}`}
              style={{
                background: s.id === currentId ? "#1a1f2c" : "transparent",
                color: s.id === currentId ? "var(--text)" : "var(--muted)",
              }}
            >
              <button
                onClick={() => setCurrentId(s.id)}
                className="flex-1 truncate text-left"
                title={s.title}
              >
                {s.title}
              </button>
              <span className="ml-2 text-[10px] opacity-0 group-hover:opacity-100">
                <button onClick={() => deleteSession(s.id)} title="Delete">
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      </aside>

      {/* Conversation pane */}
      <section
        className="flex h-[70vh] flex-col rounded-lg border"
        style={{ borderColor: "var(--border)", background: "var(--panel)" }}
      >
        <div
          ref={scrollerRef}
          className="flex-1 overflow-y-auto p-4"
          style={{ scrollBehavior: "smooth" }}
        >
          {messages.length === 0 ? (
            <EmptyState onPick={send} disabled={sending} />
          ) : (
            <ul className="space-y-3">
              {messages.map((m) => (
                <MessageRow key={m.id} message={m} />
              ))}
              {sending && (
                <li className="text-[11px]" style={{ color: "var(--muted)" }}>
                  thinking…
                </li>
              )}
            </ul>
          )}
        </div>

        {error && (
          <div
            className="border-t px-4 py-2 text-[11px]"
            style={{ borderColor: "var(--border)", color: "#fca5a5" }}
          >
            ✗ {error}
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
            placeholder="Ask anything about your project — Enter to send, Shift+Enter for newline"
            className="flex-1 resize-none rounded border bg-transparent px-3 py-2 text-xs"
            style={{ borderColor: "var(--border)", color: "var(--text)", minHeight: "44px", maxHeight: "160px" }}
            rows={1}
            disabled={sending || currentId == null}
          />
          <button
            type="submit"
            disabled={sending || !input.trim() || currentId == null}
            className="rounded border px-4 py-2 text-xs font-medium disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text)", background: "#1a1f2c" }}
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
  return (
    <li
      className="rounded-lg border p-3"
      style={{
        borderColor: isUser ? "#1f2330" : "#6f7bff44",
        background: isUser ? "#0f1218" : "#10131f",
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide"
          style={{
            background: isUser ? "#1a1f2c" : "#6f7bff22",
            color: isUser ? "var(--muted)" : "#a5b4fc",
          }}
        >
          {isUser ? "you" : "agent"}
        </span>
        {!isUser && message.model && (
          <span className="text-[10px] font-mono" style={{ color: "var(--muted)" }}>
            {message.model} · {message.input_tokens}→{message.output_tokens} tok
          </span>
        )}
      </div>
      <div className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed">
        <CitedText text={message.content} />
      </div>
      {!isUser &&
        (message.cited_claim_ids.length > 0 ||
          message.cited_artifact_ids.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.cited_claim_ids.map((id) => (
              <span
                key={`c${id}`}
                className="rounded border px-1.5 py-0.5 font-mono text-[9px]"
                style={{ borderColor: "#6f7bff44", color: "#a5b4fc", background: "#6f7bff11" }}
              >
                claim {id}
              </span>
            ))}
            {message.cited_artifact_ids.map((id) => (
              <span
                key={`a${id}`}
                className="rounded border px-1.5 py-0.5 font-mono text-[9px]"
                style={{ borderColor: "#22c55e55", color: "#86efac", background: "#22c55e11" }}
              >
                artifact {id}
              </span>
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
            className="rounded px-1 font-mono text-[10px]"
            style={{
              background:
                p.kind === "claim"
                  ? "#6f7bff22"
                  : p.kind === "artifact"
                    ? "#22c55e22"
                    : "#eab30822",
              color:
                p.kind === "claim"
                  ? "#a5b4fc"
                  : p.kind === "artifact"
                    ? "#86efac"
                    : "#fde68a",
            }}
            title={`${p.kind} #${p.id}`}
          >
            {p.raw}
          </span>
        ),
      )}
    </>
  );
}

function EmptyState({
  onPick,
  disabled,
}: {
  onPick: (q: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Start a conversation. Try one of these:
      </p>
      <ul className="w-full max-w-md space-y-1.5">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              disabled={disabled}
              onClick={() => onPick(s)}
              className="w-full rounded border px-3 py-2 text-left text-[12px] disabled:opacity-50"
              style={{ borderColor: "var(--border)", color: "var(--text)", background: "#0f1218" }}
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
