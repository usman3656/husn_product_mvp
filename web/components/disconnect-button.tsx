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
  // No backend in the static demo — disconnect would 404. Hide it.
  if (DEMO_MODE) return null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (
      !confirm(
        `Disconnect ${label}?\n\nThis wipes the OAuth token and allowlist. Historical data is kept; new syncs stop until you reconnect.`,
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
        className="rounded border px-1.5 py-0.5 text-[10px] font-medium disabled:opacity-50"
        style={{
          borderColor: "#ef444466",
          color: "#fca5a5",
          background: "#ef444411",
        }}
      >
        {busy ? "…" : "disconnect"}
      </button>
      {error && (
        <span className="text-[10px]" style={{ color: "#fca5a5" }}>
          {error}
        </span>
      )}
    </span>
  );
}
