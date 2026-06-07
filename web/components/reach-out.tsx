"use client";

import { useState } from "react";

/* ============================================================
   Reach Out For Me — the one-click outreach affordance that
   appears wherever Husn surfaces uncertainty. Opens a modal
   with: who has the answer, why, draft message, one-click send.
   ============================================================ */

export type ReachOutContext = {
  /** Short editorial reason this person likely knows the answer. */
  why: string;
  /** Display name or label. */
  who: string;
  /** Optional channel hint, e.g. "@sarah" or "sarah@…" */
  whoHandle?: string;
  /** Pre-drafted message body. */
  draft: string;
  /** "slack" | "email" — controls icon and verb. */
  via?: "slack" | "email";
  /** What this is about — short headline shown in the modal. */
  about: string;
};

export function ReachOutButton({
  context,
  variant = "primary",
  size = "md",
  children = "Reach Out For Me",
}: {
  context: ReachOutContext;
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "sm";
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={btnCls(variant, size)}
        style={btnStyle(variant)}
      >
        <SparkIcon />
        {children}
      </button>
      {open ? <ReachOutModal context={context} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function btnCls(variant: "primary" | "secondary" | "ghost", size: "md" | "sm") {
  const sz = size === "sm" ? "text-[12.5px] px-2.5 py-1" : "text-[13.5px] px-3.5 py-1.5";
  return `inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors ${sz}`;
}

function btnStyle(variant: "primary" | "secondary" | "ghost"): React.CSSProperties {
  if (variant === "primary") {
    return { background: "var(--predicted)", color: "#fff", borderColor: "var(--predicted)" };
  }
  if (variant === "secondary") {
    return { background: "var(--predicted-soft)", color: "var(--predicted-ink)", borderColor: "var(--predicted-line)" };
  }
  return { background: "transparent", color: "var(--predicted-ink)", borderColor: "transparent" };
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </svg>
  );
}

function ReachOutModal({ context, onClose }: { context: ReachOutContext; onClose: () => void }) {
  const via = context.via ?? "slack";
  const [message, setMessage] = useState(context.draft);
  const [sent, setSent] = useState(false);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reach out"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(20, 20, 20, 0.42)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-[560px] rounded-[18px] border husn-rise"
        style={{
          background: "var(--panel)",
          borderColor: "var(--border)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div className="px-6 pt-6 pb-4 border-b" style={{ borderColor: "var(--rule)" }}>
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-grid h-7 w-7 place-items-center rounded-full"
              style={{ background: "var(--predicted-soft)", color: "var(--predicted-ink)" }}
            >
              <SparkIcon />
            </span>
            <p className="husn-eyebrow" style={{ color: "var(--predicted-ink)" }}>
              Reach Out For Me
            </p>
          </div>
          <h2 className="husn-heading mt-3" style={{ fontSize: 19 }}>
            {context.about}
          </h2>
        </div>

        <div className="px-6 py-5">
          <div
            className="rounded-[12px] border p-4"
            style={{ background: "var(--panel-2)", borderColor: "var(--border)" }}
          >
            <p className="husn-eyebrow" style={{ fontSize: 10.5 }}>Who likely has the answer</p>
            <p className="mt-2 text-[15px] font-medium">{context.who}</p>
            {context.whoHandle ? (
              <p className="mt-0.5 font-mono text-[12px]" style={{ color: "var(--muted)" }}>
                {context.whoHandle}
              </p>
            ) : null}
            <p className="mt-3 text-[13px] leading-relaxed" style={{ color: "var(--text-2)" }}>
              {context.why}
            </p>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <p className="husn-eyebrow" style={{ fontSize: 10.5 }}>Draft message</p>
              <span className="husn-meta">via {via === "slack" ? "Slack" : "Email"}</span>
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full rounded-[10px] border px-3 py-2.5 text-[14px] leading-relaxed focus:outline-none"
              style={{
                borderColor: "var(--border)",
                background: "var(--panel)",
                color: "var(--text)",
                minHeight: 120,
                resize: "vertical",
              }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t" style={{ borderColor: "var(--rule)" }}>
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] font-medium"
            style={{ color: "var(--muted)" }}
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(message).catch(() => {});
                setSent(true);
                setTimeout(() => setSent(false), 1400);
              }}
              className="rounded-full border px-3.5 py-1.5 text-[13px] font-medium"
              style={{ borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text)" }}
            >
              {sent ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSent(true);
                setTimeout(onClose, 900);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-[13px] font-medium"
              style={{ background: "var(--predicted)", color: "#fff", borderColor: "var(--predicted)" }}
            >
              {sent ? "Sent" : `Send via ${via === "slack" ? "Slack" : "Email"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
