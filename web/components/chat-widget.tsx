"use client";

/**
 * Global Ask Husn popup.
 *
 * A floating launcher (bottom-right) that opens a compact chat panel on every
 * authenticated page. It is the same per-user conversation store as the
 * full-page /ask surface (lib/chat.ts → api/husn/routers/chat.py), so threads
 * started here show up there and vice-versa.
 *
 * Mounted once in the root layout. It stays mounted across client-side
 * navigation, so an open conversation survives moving between pages.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { fetchMe, type Me } from "@/lib/api";
import { CitedText } from "@/components/cited-text";
import {
  type ChatMessage,
  type SessionSummary,
  createSession,
  deleteSession,
  listMessages,
  listSessions,
  sendMessage,
} from "@/lib/chat";

/* Pages that render their own shell-free surface, or where a chat launcher
 * would be noise. /ask already IS the full chat, so we skip it there too. */
const HIDDEN_PREFIXES = [
  "/login",
  "/welcome",
  "/privacy",
  "/terms",
  "/subprocessors",
  "/healthz",
  "/slack/link",
  "/ask",
];

const LAST_SESSION_KEY = "husn.chat.lastSession";

export function ChatWidget() {
  const pathname = usePathname() || "/";
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetchMe().then(setMe);
  }, [pathname]);

  const hidden = HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  // Render only for usable sessions: signed in, or auth not yet required
  // (bridge mode). Mirrors the gating SideNav applies to the rest of the shell.
  const usable = me != null && (me.authenticated || !me.auth_required);

  // Close the panel when navigating to a page where it shouldn't show.
  useEffect(() => {
    if (hidden && open) setOpen(false);
  }, [hidden, open]);

  if (hidden || !usable) return null;

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ask Husn"
          title="Ask Husn"
          className="fixed bottom-5 right-5 z-50 grid h-12 w-12 place-items-center rounded-full husn-lift"
          style={{
            background: "var(--text)",
            color: "var(--bg)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 6.5C4 5.12 5.12 4 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4 3v-3H6.5A2.5 2.5 0 0 1 4 14.5v-8Z" />
            <path d="M9 9.5h.01M12 9.5h.01M15 9.5h.01" />
          </svg>
        </button>
      ) : (
        <ChatPanel onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ChatPanel({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // First open: load the session list and resume the last-used thread if any.
  useEffect(() => {
    (async () => {
      try {
        const items = await listSessions();
        setSessions(items);
        const remembered = Number(
          typeof window !== "undefined" ? window.localStorage.getItem(LAST_SESSION_KEY) : NaN,
        );
        const resume = items.find((s) => s.id === remembered) ?? items[0];
        setCurrentId(resume ? resume.id : null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load conversations");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Load the thread whenever the active session changes.
  useEffect(() => {
    if (currentId == null) {
      setMessages([]);
      return;
    }
    if (typeof window !== "undefined") window.localStorage.setItem(LAST_SESSION_KEY, String(currentId));
    let cancelled = false;
    (async () => {
      try {
        const items = await listMessages(currentId);
        if (!cancelled) setMessages(items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load conversation");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  // Keep the thread pinned to the latest turn.
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages, sending]);

  // Escape closes the panel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await listSessions());
    } catch {
      /* non-fatal — the thread is what matters */
    }
  }, []);

  async function startNew() {
    setError(null);
    try {
      const id = await createSession();
      await refreshSessions();
      setCurrentId(id);
      setShowList(false);
      inputRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start a conversation");
    }
  }

  async function removeSession(id: number) {
    if (!confirm("Delete this conversation?")) return;
    try {
      await deleteSession(id);
      if (currentId === id) setCurrentId(null);
      await refreshSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    }
  }

  async function send(content: string) {
    const text = content.trim();
    if (!text || sending) return;

    // No active session yet → create one, then send into it.
    let targetId = currentId;
    if (targetId == null) {
      try {
        targetId = await createSession();
        setCurrentId(targetId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not start a conversation");
        return;
      }
    }

    setSending(true);
    setError(null);
    const optimistic: ChatMessage = {
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
      await sendMessage(targetId, text);
      setMessages(await listMessages(targetId));
      await refreshSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
      // The backend persists the user turn before calling the model, and on
      // rate-limit (429) / agent-failure (502) it also persists an assistant
      // explanation. Re-fetch so those surface instead of dropping the user's
      // message; only fall back to removing the optimistic bubble if even the
      // re-fetch fails (e.g. a genuine network drop where nothing was saved).
      try {
        setMessages(await listMessages(targetId));
      } catch {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      role="dialog"
      aria-label="Ask Husn"
      className="fixed z-50 flex flex-col husn-rise bottom-0 right-0 left-0 sm:bottom-5 sm:right-5 sm:left-auto sm:w-[400px] border sm:rounded-[var(--radius-lg)] overflow-hidden"
      style={{
        height: "min(620px, 88vh)",
        background: "var(--panel)",
        borderColor: "var(--border)",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      {/* Header */}
      <header
        className="flex items-center gap-2 px-4 py-3 border-b"
        style={{ borderColor: "var(--rule)", background: "var(--panel)" }}
      >
        <span
          aria-hidden
          className="grid h-6 w-6 place-items-center rounded-full"
          style={{ background: "var(--text)", color: "var(--bg)" }}
        >
          <span className="text-[11px] font-semibold leading-none">h</span>
        </span>
        <p className="flex-1 text-[13.5px] font-semibold" style={{ color: "var(--text)" }}>
          {showList ? "Conversations" : "Ask Husn"}
        </p>
        <IconButton
          label={showList ? "Back to conversation" : "Show conversations"}
          onClick={() => setShowList((s) => !s)}
        >
          {showList ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          )}
        </IconButton>
        <IconButton label="New conversation" onClick={startNew}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </IconButton>
        <IconButton label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </IconButton>
      </header>

      {/* Body */}
      {loading ? (
        <div className="flex-1 grid place-items-center px-6">
          <p className="text-[13px]" style={{ color: "var(--muted)" }}>Opening…</p>
        </div>
      ) : showList ? (
        <SessionList
          sessions={sessions}
          currentId={currentId}
          onPick={(id) => {
            setCurrentId(id);
            setShowList(false);
          }}
          onDelete={removeSession}
          onNew={startNew}
        />
      ) : (
        <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 && !sending ? (
            <WidgetEmptyState onPick={send} disabled={sending} />
          ) : (
            <ol className="space-y-4">
              {messages.map((m) => (
                <li key={m.id}>
                  <Bubble m={m} />
                </li>
              ))}
              {sending ? (
                <li>
                  <Thinking />
                </li>
              ) : null}
            </ol>
          )}
          {error ? (
            <div
              className="mt-4 rounded-[var(--radius-sm)] border px-3 py-2 text-[12px]"
              style={{ borderColor: "var(--warning-line)", background: "var(--warning-soft)", color: "var(--warning-ink)" }}
            >
              {error}
            </div>
          ) : null}
        </div>
      )}

      {/* Composer — hidden while browsing the list */}
      {!showList && !loading ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="border-t px-3 py-3"
          style={{ borderColor: "var(--rule)" }}
        >
          <div
            className="flex items-end gap-2 rounded-[14px] border px-3 py-2"
            style={{ borderColor: "var(--border-strong)", background: "var(--panel)" }}
          >
            <textarea
              ref={inputRef}
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Ask Husn anything…"
              className="flex-1 resize-none bg-transparent text-[13.5px] leading-relaxed focus:outline-none"
              style={{ color: "var(--text)", minHeight: 22, maxHeight: 120 }}
              rows={1}
              disabled={sending}
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full disabled:opacity-40"
              style={{ background: "var(--text)", color: "var(--bg)" }}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-7 w-7 place-items-center rounded-full"
      style={{ color: "var(--muted)" }}
    >
      {children}
    </button>
  );
}

function SessionList({
  sessions,
  currentId,
  onPick,
  onDelete,
  onNew,
}: {
  sessions: SessionSummary[];
  currentId: number | null;
  onPick: (id: number) => void;
  onDelete: (id: number) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto px-3 py-3">
      {sessions.length === 0 ? (
        <div className="px-2 py-6 text-center">
          <p className="text-[13px]" style={{ color: "var(--muted)" }}>No conversations yet.</p>
          <button
            type="button"
            onClick={onNew}
            className="mt-3 rounded-full border px-3 py-1.5 text-[12.5px] font-medium"
            style={{ borderColor: "var(--text)", background: "var(--text)", color: "var(--bg)" }}
          >
            Start one
          </button>
        </div>
      ) : (
        <ul className="space-y-0.5">
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
                <button onClick={() => onPick(s.id)} className="flex-1 truncate text-left" title={s.title}>
                  {s.title}
                </button>
                <button
                  onClick={() => onDelete(s.id)}
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
  );
}

const WIDGET_SUGGESTIONS = [
  "What changed this week?",
  "What's at risk in the plan right now?",
  "Who is blocked and waiting on an answer?",
];

function WidgetEmptyState({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) {
  return (
    <div className="px-1 py-2">
      <p className="text-[14px] font-semibold" style={{ color: "var(--text)" }}>
        Ask anything about your organization.
      </p>
      <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--muted)" }}>
        Husn answers from your sources. Every claim is cited.
      </p>
      <div className="mt-4 space-y-1.5">
        {WIDGET_SUGGESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={disabled}
            onClick={() => onPick(q)}
            className="block w-full text-left rounded-[var(--radius-sm)] border px-3 py-2 text-[13px] husn-lift"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-[14px] px-3 py-2 text-[13.5px] whitespace-pre-wrap"
          style={{ background: "var(--text)", color: "var(--bg)" }}
        >
          {m.content}
        </div>
      </div>
    );
  }

  const evidenceCount = m.cited_claim_ids.length + m.cited_artifact_ids.length;
  return (
    <div
      className="rounded-[14px] border px-3 py-2.5"
      style={{ borderColor: "var(--border)", background: "var(--panel-2)" }}
    >
      <div className="text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text)" }}>
        <CitedText text={m.content} />
      </div>
      {evidenceCount > 0 ? (
        <p className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>
          {evidenceCount} cited {evidenceCount === 1 ? "source" : "sources"}
        </p>
      ) : null}
    </div>
  );
}

function Thinking() {
  return (
    <div
      className="rounded-[14px] border px-3 py-2.5"
      style={{ borderColor: "var(--border)", background: "var(--panel-2)" }}
    >
      <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: "var(--muted)" }}>
        Reading your sources
        <span aria-hidden style={{ display: "inline-flex", gap: 4 }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: 4,
                height: 4,
                borderRadius: 999,
                background: "var(--muted)",
                display: "inline-block",
                animation: `husn-typing 0.9s ease ${i * 0.15}s infinite`,
              }}
            />
          ))}
        </span>
      </span>
    </div>
  );
}
