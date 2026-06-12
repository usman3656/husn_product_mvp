"use client";

import { useState } from "react";

import { clientFetch } from "@/lib/api";

/** Sync now — fans out backfill + normalize + extract + drift + render in one
 * click. Lives on the briefing header; admin-only on the API side (the button
 * stays mounted for members too, the request just 403s for them). */
export function SyncNowButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await clientFetch("/api/sync/now", { method: "POST" });
      if (!r.ok) {
        const text = await r.text();
        setMsg(`error: ${text.slice(0, 140)}`);
        return;
      }
      setMsg("Queued. Briefing refreshes in ~60s — reload to see it.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        onClick={go}
        disabled={busy}
        className="rounded-full border px-4 py-1.5 text-[13px] font-medium disabled:opacity-50"
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
