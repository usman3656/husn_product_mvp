"use client";

import { useState } from "react";

import { clientFetch } from "@/lib/api";

/* ============================================================
   /login — the front door. One field. Editorial, calm.
   Magic-link only at v1 ("Continue with Google" lands later).
   ============================================================ */

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = email.trim();
    if (!v || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await clientFetch("/auth/login/magic", {
        method: "POST",
        body: JSON.stringify({ email: v }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSent(true);
    } catch {
      setError("Could not send the link. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full husn-rise" style={{ maxWidth: 420 }}>
        {/* Mark */}
        <div className="flex items-center gap-2.5 mb-10">
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-[9px]"
            style={{ background: "var(--text)", color: "var(--bg)" }}
          >
            <span className="text-[14px] font-semibold leading-none" style={{ letterSpacing: "-0.04em" }}>h</span>
          </span>
          <span className="text-[16px] font-semibold tracking-tight">husn</span>
        </div>

        {sent ? (
          <div>
            <h1 className="husn-title">Check your email.</h1>
            <p className="husn-prose mt-4">
              We sent a sign-in link to <strong style={{ color: "var(--text)" }}>{email.trim()}</strong>.
              It works once and expires in 15 minutes.
            </p>
            <button
              type="button"
              onClick={() => setSent(false)}
              className="mt-8 text-[13.5px] font-medium"
              style={{ color: "var(--muted)" }}
            >
              ← Use a different email
            </button>
          </div>
        ) : (
          <div>
            <h1 className="husn-title">Sign in to Husn.</h1>
            <p className="husn-prose mt-3" style={{ fontSize: 15 }}>
              The intelligence layer for your organization. Enter your work
              email — we&apos;ll send you a one-time sign-in link.
            </p>

            <form onSubmit={submit} className="mt-8">
              <label htmlFor="email" className="husn-eyebrow" style={{ fontSize: 10.5 }}>
                Work email
              </label>
              <input
                id="email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="mt-2 w-full rounded-[12px] border px-4 py-3 text-[15px] focus:outline-none"
                style={{
                  borderColor: "var(--border-strong)",
                  background: "var(--panel)",
                  color: "var(--text)",
                }}
              />
              <button
                type="submit"
                disabled={busy || !email.trim()}
                className="mt-4 w-full rounded-full border px-4 py-3 text-[14.5px] font-semibold disabled:opacity-50"
                style={{ background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }}
              >
                {busy ? "Sending…" : "Send sign-in link"}
              </button>
            </form>

            {error ? (
              <p className="mt-4 text-[13px]" style={{ color: "var(--danger-ink)" }}>{error}</p>
            ) : null}

            <p className="mt-10 text-[12.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
              New here? Sign in with your email and you&apos;ll be able to create
              your company&apos;s workspace. If your team already uses Husn, ask
              your admin to add your email first.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
