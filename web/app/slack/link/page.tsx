"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { clientFetch } from "@/lib/api";

/* ============================================================
   /slack/link?token=… — confirm linking a Slack user to this
   Husn account. The bot DMs this link; the page (signed in)
   shows which Slack user will be linked, then POSTs to confirm.
   ============================================================ */

type Preview = { slack_team_id: string; slack_user_id: string; husn_email: string | null };

function LinkInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linked, setLinked] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoadErr("Missing link token. Message the bot again for a fresh link.");
      return;
    }
    (async () => {
      try {
        // Direct fetch (not clientFetch) so a 401 doesn't bounce us to /login
        // and discard the token — we surface a sign-in prompt instead.
        const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "https://api.husn.io";
        const r = await fetch(`${apiBase}/api/slack/link/preview?token=${encodeURIComponent(token)}`, {
          credentials: "include",
        });
        if (r.status === 401) {
          setNeedsLogin(true);
          return;
        }
        if (!r.ok) {
          const detail = await r.json().then((j) => j?.detail).catch(() => null);
          setLoadErr(typeof detail === "string" ? detail : "This link is invalid or has expired.");
          return;
        }
        setPreview((await r.json()) as Preview);
      } catch {
        setLoadErr("Couldn't load the link. Try again.");
      }
    })();
  }, [token]);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await clientFetch("/api/slack/link", { method: "POST", body: JSON.stringify({ token }) });
      if (!r.ok) {
        const detail = await r.json().then((j) => j?.detail).catch(() => null);
        setErr(typeof detail === "string" ? detail : "Couldn't link. Try again.");
        return;
      }
      setLinked(true);
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full husn-rise" style={{ maxWidth: 420 }}>
        <div className="flex items-center gap-2.5 mb-10">
          <span aria-hidden className="grid h-8 w-8 place-items-center rounded-[9px]" style={{ background: "var(--text)", color: "var(--bg)" }}>
            <span className="text-[14px] font-semibold leading-none" style={{ letterSpacing: "-0.04em" }}>h</span>
          </span>
          <span className="text-[16px] font-semibold tracking-tight">husn</span>
        </div>

        {linked ? (
          <div>
            <h1 className="husn-title">You&apos;re linked. ✅</h1>
            <p className="husn-prose mt-4">
              Head back to Slack and message Husn — it&apos;ll now answer about your
              briefing using your account.
            </p>
          </div>
        ) : needsLogin ? (
          <div>
            <h1 className="husn-title">Sign in to link.</h1>
            <p className="husn-prose mt-4">
              Sign in to Husn first (opens in a new tab), then come back to this
              page and click <strong style={{ color: "var(--text)" }}>Link account</strong>.
            </p>
            <a
              href="/login"
              target="_blank"
              rel="noreferrer"
              className="mt-8 inline-block rounded-full border px-5 py-3 text-[14.5px] font-semibold"
              style={{ background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }}
            >
              Sign in to Husn →
            </a>
            <button
              type="button"
              onClick={() => { setNeedsLogin(false); setPreview(null); location.reload(); }}
              className="mt-4 block text-[13px] font-medium"
              style={{ color: "var(--accent)" }}
            >
              I&apos;ve signed in — continue
            </button>
          </div>
        ) : loadErr ? (
          <div>
            <h1 className="husn-title">Link unavailable.</h1>
            <p className="husn-prose mt-4">{loadErr}</p>
          </div>
        ) : !preview ? (
          <p className="husn-prose">Loading…</p>
        ) : (
          <div>
            <h1 className="husn-title">Link your Slack to Husn.</h1>
            <p className="husn-prose mt-3" style={{ fontSize: 15 }}>
              This connects Slack user <strong style={{ color: "var(--text)" }}>{preview.slack_user_id}</strong>{" "}
              to your Husn account{preview.husn_email ? <> (<strong style={{ color: "var(--text)" }}>{preview.husn_email}</strong>)</> : null}.
              Only link a Slack account that is yours.
            </p>
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="mt-8 w-full rounded-full border px-4 py-3 text-[14.5px] font-semibold disabled:opacity-50"
              style={{ background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }}
            >
              {busy ? "Linking…" : "Link account"}
            </button>
            {err ? <p className="mt-4 text-[13px]" style={{ color: "var(--danger-ink)" }}>{err}</p> : null}
          </div>
        )}
      </div>
    </main>
  );
}

export default function SlackLinkPage() {
  return (
    <Suspense>
      <LinkInner />
    </Suspense>
  );
}
