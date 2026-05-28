"use client";

import { useState } from "react";

import { DEMO_MODE } from "@/lib/demo";
import { Pill } from "@/components/ui";

const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function RunButtonClient({ inProgress }: { inProgress: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // No backend in the static demo: show a calm "snapshot" pill, no controls.
  if (DEMO_MODE) {
    return <Pill tone="neutral">Snapshot</Pill>;
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
        setMessage(`queued, refresh in a moment (${String(jobId).slice(0, 8)})`);
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
        <span className="text-[11px]" style={{ color: "var(--muted)" }}>
          {message}
        </span>
      )}
      <button
        onClick={trigger}
        disabled={disabled}
        className="rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 disabled:opacity-50"
        style={{ borderColor: "var(--border-strong)", color: "var(--text)", background: "var(--panel)" }}
      >
        {busy ? "Starting" : inProgress ? "Refreshing" : "Refresh briefs"}
      </button>
    </div>
  );
}
