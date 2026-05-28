"use client";

import { useState } from "react";

import { DEMO_MODE } from "@/lib/demo";

const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function DisconnectButton({
  connectionId,
  label,
}: {
  connectionId: number;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // No backend in the static demo (disconnect would 404). Hide it.
  if (DEMO_MODE) return null;

  async function go() {
    if (
      !confirm(
        `Disconnect ${label}? This clears the saved access and allowlist. Past data is kept; new syncs stop until you reconnect.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${BROWSER_API_URL}/api/connections/${connectionId}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "disconnect failed");
      setBusy(false);
    }
  }

  return (
    <span className="ml-2 inline-flex items-center gap-1">
      <button
        onClick={go}
        disabled={busy}
        title={`Disconnect ${label}`}
        className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 disabled:opacity-50"
        style={{ borderColor: "var(--danger-line)", color: "var(--danger-ink)", background: "var(--danger-soft)" }}
      >
        {busy ? "…" : "Disconnect"}
      </button>
      {error && (
        <span className="text-[11px]" style={{ color: "var(--danger-ink)" }}>
          {error}
        </span>
      )}
    </span>
  );
}
