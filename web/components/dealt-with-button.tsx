"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { clientFetch } from "@/lib/api";

/** "This has been dealt with" — the TPM disposition button on a finding.
 * Marks the issue handled (hidden everywhere; won't resurface unless the
 * conflict materially changes), then refreshes the server-rendered cards.
 * `size="sm"` matches the compact action rows in lists. */
export function DealtWithButton({
  findingId,
  size = "md",
}: {
  findingId: number;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(false);

  async function go(e: React.MouseEvent) {
    // These buttons sometimes sit inside clickable cards/links — don't bubble.
    e.preventDefault();
    e.stopPropagation();
    if (busy || done) return;
    if (!confirm("Mark this as dealt with? It won't show again unless the conflict changes.")) return;
    setBusy(true);
    setErr(false);
    try {
      const r = await clientFetch(`/api/findings/${findingId}/dealt-with`, { method: "POST" });
      if (!r.ok) throw new Error();
      setDone(true);
      router.refresh();
    } catch {
      setErr(true);
      setBusy(false);
    }
  }

  const pad = size === "sm" ? "px-2.5 py-1 text-[12.5px]" : "px-3 py-1.5 text-[13px]";
  return (
    <button
      type="button"
      onClick={go}
      disabled={busy || done}
      className={`rounded-full border font-medium disabled:opacity-60 ${pad}`}
      style={{ borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text-2)" }}
      title="Mark this issue as handled so it stops surfacing"
    >
      {done ? "Dealt with ✓" : busy ? "Saving…" : err ? "Try again" : "This has been dealt with"}
    </button>
  );
}
