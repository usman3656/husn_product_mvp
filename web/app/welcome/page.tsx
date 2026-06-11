"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { clientFetch } from "@/lib/api";

/* ============================================================
   /welcome — the new-company fork. Reached after a verified
   sign-in with an email that belongs to no workspace.
   Creating the workspace makes the caller its owner; the
   onboarding trail (invite teammates → connect tools → pick
   scope) continues inside Settings + Connections, which the
   success screen points at.
   ============================================================ */

export default function WelcomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const v = name.trim();
    if (v.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await clientFetch("/auth/workspace", {
        method: "POST",
        body: JSON.stringify({ name: v }),
      });
      if (!r.ok) {
        const body = await r.text();
        throw new Error(body.slice(0, 120));
      }
      router.replace("/?welcome=1");
    } catch {
      setError("Could not create the workspace. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full husn-rise" style={{ maxWidth: 460 }}>
        <p className="husn-eyebrow">No workspace found for your email</p>
        <h1 className="husn-title mt-3">Name your company&apos;s workspace.</h1>
        <p className="husn-prose mt-3" style={{ fontSize: 15 }}>
          You&apos;ll be its owner. From there: add your teammates&apos; emails in
          Settings, connect Slack / Jira / Google / Microsoft once for the whole
          company, and your first briefing starts building.
        </p>

        <form onSubmit={create} className="mt-8">
          <label htmlFor="ws" className="husn-eyebrow" style={{ fontSize: 10.5 }}>
            Company / workspace name
          </label>
          <input
            id="ws"
            type="text"
            required
            autoFocus
            minLength={2}
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Corp"
            className="mt-2 w-full rounded-[12px] border px-4 py-3 text-[15px] focus:outline-none"
            style={{ borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text)" }}
          />
          <button
            type="submit"
            disabled={busy || name.trim().length < 2}
            className="mt-4 w-full rounded-full border px-4 py-3 text-[14.5px] font-semibold disabled:opacity-50"
            style={{ background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }}
          >
            {busy ? "Creating…" : "Create workspace"}
          </button>
        </form>

        {error ? (
          <p className="mt-4 text-[13px]" style={{ color: "var(--danger-ink)" }}>{error}</p>
        ) : null}

        <p className="mt-10 text-[12.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Expecting to join an existing company? Ask your admin to add your
          email in their Settings → Members, then sign in again.
        </p>
      </div>
    </main>
  );
}
