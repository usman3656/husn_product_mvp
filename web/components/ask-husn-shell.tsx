"use client";

import { useEffect, useRef, useState } from "react";

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

const SUGGESTIONS: { label: string; q: string }[] = [
  { label: "What changed this week?", q: "What changed this week across the program?" },
  { label: "Why is launch delayed?", q: "Why is the launch delayed, and who is the source of truth right now?" },
  { label: "What assumptions are at risk?", q: "What assumptions in the plan are at risk, given recent activity?" },
  { label: "Who needs an answer?", q: "Who is currently blocked and waiting on someone else for an answer?" },
  { label: "Where are we drifting?", q: "Which workstreams are drifting between Jira and Slack right now?" },
];

export function AskHusnShell() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSessions, setShowSessions] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await clientFetch("/api/chat/sessions");
        const body = (await r.json()) as { items: SessionSummary[] };
        setSessions(body.items);
        if (body.items.length > 0) setCurrentId(body.items[0].id);
        else await createSession(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (currentId == null) { setMessages([]); return; }
    (async () => {
      try {
        const r = await clientFetch(`/api/chat/sessions/${currentId}/messages`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = (await r.json()) as { items: Message[] };
        setMessages(body.items);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load conversation");
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
      const r = await clientFetch(`/api/chat/sessions/${currentId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!r.ok) throw new Error((await r.text()).slice(0, 200));
      const list = await (await clientFetch(`/api/chat/sessions/${currentId}/messages`)).json();
      setMessages(list.items);
      await refreshSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto py-32 text-center" style={{ maxWidth: 600 }}>
        <p className="text-[14px]" style={{ color: "var(--muted)" }}>
          Opening your conversation…
        </p>
      </div>
    );
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="relative" style={{ minHeight: "calc(100vh - 40px)" }}>
      {/* Floating session control */}
      <div className="absolute top-6 right-6 flex items-center gap-2 z-10">
        <button
          onClick={() => setShowSessions((s) => !s)}
          className="rounded-full border px-3 py-1.5 text-[12.5px] font-medium"
          style={{
            borderColor: "var(--border)",
            background: "var(--panel)",
            color: "var(--muted)",
          }}
          aria-label="Conversations"
        >
          Conversations
        </button>
        <button
          onClick={() => createSession(true)}
          className="rounded-full border px-3 py-1.5 text-[12.5px] font-medium"
          style={{
            borderColor: "var(--text)",
            background: "var(--text)",
            color: "var(--bg)",
          }}
        >
          New
        </button>
      </div>

      {/* Slide-over session list */}
      {showSessions ? (
        <div className="absolute top-20 right-6 w-[280px] z-20 rounded-[var(--radius)] border p-3"
             style={{ borderColor: "var(--border)", background: "var(--panel)", boxShadow: "var(--shadow-md)" }}>
          <p className="husn-eyebrow mb-3 px-1">Recent</p>
          {sessions.length === 0 ? (
            <p className="text-[12.5px] px-1" style={{ color: "var(--muted)" }}>
              No conversations yet.
            </p>
          ) : (
            <ul className="space-y-0.5 max-h-[60vh] overflow-y-auto">
              {sessions.map((s) => {
                const active = s.id === currentId;
                return (
                  <li
                    key={s.id}
                    className="group flex items-center justify-between rounded-[8px] px-2 py-1.5 text-[13px]"
                    style={{
                      background: active ? "var(--panel-2)" : "transparent",
                      color: active ? "var(--text)" : "var(--text-2)",
                    }}
                  >
                    <button
                      onClick={() => { setCurrentId(s.id); setShowSessions(false); }}
                      className="flex-1 truncate text-left"
                      title={s.title}
                    >
                      {s.title}
                    </button>
                    <button
                      onClick={() => deleteSession(s.id)}
                      title="Delete"
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
        </div>
      ) : null}

      {/* Conversation column */}
      <div
        ref={scrollerRef}
        className="mx-auto px-6 lg:px-10 pt-16 pb-48 overflow-y-auto"
        style={{ maxWidth: 760, minHeight: "calc(100vh - 40px)" }}
      >
        {isEmpty ? (
          <EmptyState onPick={send} disabled={sending} />
        ) : (
          <ol className="space-y-12">
            {messages.map((m) => (
              <li key={m.id}>
                <MessageBlock m={m} />
              </li>
            ))}
            {sending ? (
              <li>
                <ThinkingBlock />
              </li>
            ) : null}
          </ol>
        )}

        {error ? (
          <div
            className="mt-8 rounded-[var(--radius)] border px-4 py-3 text-[13px]"
            style={{ borderColor: "var(--warning-line)", background: "var(--warning-soft)", color: "var(--warning-ink)" }}
          >
            {error}
          </div>
        ) : null}
      </div>

      {/* Composer — fixed to the reading column */}
      <div
        className="fixed bottom-0 left-0 right-0 md:left-[var(--nav-w)] z-10"
        style={{
          background: "linear-gradient(to bottom, transparent 0%, var(--bg) 30%)",
          paddingBottom: 28,
          paddingTop: 28,
        }}
      >
        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="mx-auto px-6 lg:px-10"
          style={{ maxWidth: 760 }}
        >
          <div
            className="flex items-end gap-2 rounded-[18px] border px-4 py-3"
            style={{
              borderColor: "var(--border-strong)",
              background: "var(--panel)",
              boxShadow: "var(--shadow-md)",
            }}
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
              placeholder="Ask Husn anything about your organization…"
              className="flex-1 resize-none bg-transparent text-[15px] leading-relaxed focus:outline-none"
              style={{ color: "var(--text)", minHeight: 26, maxHeight: 200 }}
              rows={1}
              disabled={sending || currentId == null}
            />
            <button
              type="submit"
              disabled={sending || !input.trim() || currentId == null}
              aria-label="Send"
              className="grid h-9 w-9 place-items-center rounded-full disabled:opacity-40"
              style={{ background: "var(--text)", color: "var(--bg)" }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
          <p className="mt-3 text-center text-[11.5px]" style={{ color: "var(--muted-2)" }}>
            Husn answers from your sources. Every claim is cited.
          </p>
        </form>
      </div>
    </div>
  );
}

function EmptyState({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) {
  return (
    <div style={{ marginTop: 60 }}>
      <p className="husn-eyebrow">Ask Husn</p>
      <h1 className="husn-display mt-4">Ask anything about your organization.</h1>
      <p className="husn-prose mt-5 max-w-[58ch]">
        Husn reads across Jira, Slack, Google, and Microsoft, and answers with the
        evidence in your tools. Every claim points back to its source.
      </p>

      <div className="mt-12">
        <p className="husn-eyebrow">Try</p>
        <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {SUGGESTIONS.map((s) => (
            <li key={s.label}>
              <button
                disabled={disabled}
                onClick={() => onPick(s.q)}
                className="group block w-full text-left rounded-[var(--radius)] border px-5 py-4 husn-lift"
                style={{
                  borderColor: "var(--border)",
                  background: "var(--panel)",
                  color: "var(--text)",
                }}
              >
                <p className="text-[14.5px] font-medium">{s.label}</p>
                <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted)" }}>
                  {s.q}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MessageBlock({ m }: { m: Message }) {
  if (m.role === "user") {
    return (
      <div>
        <p className="husn-eyebrow" style={{ color: "var(--muted-2)" }}>You asked</p>
        <p
          className="mt-2 text-[22px] leading-snug font-medium"
          style={{ letterSpacing: "-0.018em", color: "var(--text)" }}
        >
          {m.content}
        </p>
      </div>
    );
  }

  const evidenceCount = m.cited_claim_ids.length + m.cited_artifact_ids.length;
  const hasEvidence = evidenceCount > 0;

  return (
    <article
      className="rounded-[var(--radius-lg)] border overflow-hidden"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      {/* Header */}
      <div className="px-6 pt-6 pb-3 flex items-center gap-2">
        <span
          aria-hidden
          className="inline-grid h-6 w-6 place-items-center rounded-full"
          style={{ background: "var(--text)", color: "var(--bg)" }}
        >
          <span className="text-[11px] font-semibold leading-none">h</span>
        </span>
        <p className="husn-eyebrow" style={{ color: "var(--accent-ink)" }}>Husn says</p>
      </div>

      {/* Conclusion */}
      <div className="px-6 pb-6">
        <p className="husn-eyebrow" style={{ fontSize: 10.5 }}>Conclusion</p>
        <div
          className="mt-2 husn-prose whitespace-pre-wrap"
          style={{ fontSize: 17.5, lineHeight: 1.6, color: "var(--text)" }}
        >
          <CitedText text={m.content} />
        </div>
      </div>

      {/* Evidence */}
      {hasEvidence ? (
        <div
          className="px-6 py-5 border-t"
          style={{ borderColor: "var(--rule)", background: "var(--panel-2)" }}
        >
          <p className="husn-eyebrow" style={{ fontSize: 10.5 }}>Evidence ({evidenceCount})</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {m.cited_artifact_ids.map((id) => (
              <Footnote key={`a${id}`} label={`Source #${id}`} kind="source" />
            ))}
            {m.cited_claim_ids.map((id) => (
              <Footnote key={`c${id}`} label={`Fact #${id}`} kind="fact" />
            ))}
          </div>
        </div>
      ) : null}

      {/* Recommended next step */}
      {hasEvidence ? (
        <div
          className="px-6 py-4 border-t flex flex-wrap items-center justify-between gap-3"
          style={{ borderColor: "var(--rule)" }}
        >
          <p className="text-[13px]" style={{ color: "var(--muted)" }}>
            Want Husn to investigate further, or draft a message to the people closest to the answer?
          </p>
          <div className="flex items-center gap-2">
            <a
              href="/"
              className="rounded-full border px-3 py-1.5 text-[12.5px] font-medium"
              style={{ borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text)" }}
            >
              See briefing
            </a>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ThinkingBlock() {
  return (
    <div>
      <p className="husn-eyebrow" style={{ color: "var(--accent-ink)" }}>Husn</p>
      <p className="mt-2 husn-prose" style={{ fontSize: 17, color: "var(--muted)" }}>
        <span className="inline-flex items-center gap-1.5">
          Reading your sources
          <span aria-hidden style={{ display: "inline-flex", gap: 4 }}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: 4, height: 4, borderRadius: 999,
                  background: "var(--muted)",
                  display: "inline-block",
                  animation: `husn-rise 0.6s ease ${i * 0.15}s infinite alternate`,
                }}
              />
            ))}
          </span>
        </span>
      </p>
    </div>
  );
}

function Footnote({ label, kind = "neutral" }: { label: string; kind?: "neutral" | "source" | "fact" }) {
  const styles: Record<string, React.CSSProperties> = {
    neutral: { background: "var(--panel-2)", color: "var(--muted)", borderColor: "var(--border)" },
    source: { background: "var(--understood-soft)", color: "var(--accent-ink)", borderColor: "var(--understood-line)" },
    fact: { background: "var(--predicted-soft)", color: "var(--predicted-ink)", borderColor: "var(--predicted-line)" },
  };
  return (
    <span
      className="inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[10.5px]"
      style={styles[kind]}
    >
      {label}
    </span>
  );
}

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
          <sup
            key={i}
            className="ml-0.5 mr-0.5 font-mono text-[10px] cursor-help"
            style={{ color: "var(--accent-ink)" }}
            title={`Cited ${p.kind} #${p.id}`}
          >
            [{p.id}]
          </sup>
        ),
      )}
    </>
  );
}
