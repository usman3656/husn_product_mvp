"use client";

import { useState } from "react";

import { clientFetch } from "@/lib/api";

/** Sync now — enqueues the ordered ingest → derive → render pipeline in one
 * click. Admin-only: the server gates it (require_admin) and we also hide the
 * button for non-admins so members don't click a button that only 403s. Pass
 * `isAdmin` from the server component that knows the viewer's workspace role. */
export function SyncNowButton({ isAdmin = false }: { isAdmin?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!isAdmin) return null;

  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await clientFetch("/api/sync/now", { method: "POST" });
      if (!r.ok) {
        // Friendly, role-aware messages instead of dumping the raw API body.
        if (r.status === 403) setMsg("Only workspace admins can trigger a sync.");
        else if (r.status === 429) setMsg("A sync is already running — try again shortly.");
        else setMsg("Couldn't start the sync. Please try again.");
        return;
      }
      const data = (await r.json().catch(() => null)) as
        | { queued?: boolean; reason?: string }
        | null;
      if (data && data.queued === false) {
        setMsg(data.reason ?? "A sync is already running.");
        return;
      }
      setMsg("Sync started. A full refresh takes a few minutes — reload to see it.");
    } catch {
      setMsg("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        aria-busy={busy}
        className="rounded-full border px-4 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50"
        style={{
          borderColor: "var(--accent)",
          background: "var(--accent)",
          color: "var(--on-accent)",
        }}
      >
        {busy ? "Syncing…" : "Sync now"}
      </button>
      {msg ? (
        <span className="text-[12px]" style={{ color: "var(--muted)" }}>
          {msg}
        </span>
      ) : null}
    </div>
  );
}
