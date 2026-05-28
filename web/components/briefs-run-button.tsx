"use client";

import { useState } from "react";

import { DEMO_MODE } from "@/lib/demo";

const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function RunButtonClient({ inProgress }: { inProgress: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // No backend in the static demo — show a disabled "demo snapshot" pill.
  if (DEMO_MODE) {
    return (
      <span
        className="rounded border px-3 py-1.5 text-xs font-medium"
        style={{ borderColor: "var(--border)", color: "var(--muted)", background: "#0f1218" }}
        title="This is a static snapshot — live re-runs are disabled"
      >
        demo snapshot
      </span>
    );
  }

  async function trigger() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch(`${BROWSER_API_URL}/api/agent/run?async_mode=true`, {
        method: "POST",
      });
      if (!r.ok) {
        const text = await r.text();
        setMessage(`error: ${text.slice(0, 120)}`);
      } else {
        const body = await r.json();
        const jobId = body.job_id ?? "queued";
        setMessage(`queued ${String(jobId).slice(0, 8)} · refresh in ~10-30s`);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "request failed");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || inProgress;
  return (
    <div className="flex items-center gap-2">
      {message && (
        <span className="text-[10px]" style={{ color: "var(--muted)" }}>
          {message}
        </span>
      )}
      <button
        onClick={trigger}
        disabled={disabled}
        className="rounded border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        style={{ borderColor: "var(--border)", color: "var(--text)", background: "#1a1f2c" }}
      >
        {busy ? "Queuing…" : inProgress ? "Running…" : "Run analysis"}
      </button>
    </div>
  );
}
