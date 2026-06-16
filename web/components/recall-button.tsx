"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { clientFetch } from "@/lib/api";

/** "Recall" — the inverse of <DealtWithButton>. Clears the disposition on a
 * resolved (snoozed) finding so it surfaces again as an open issue, then
 * refreshes the server-rendered list. Lives in the Resolved folder. */
export function RecallButton({
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
    if (!confirm("Recall this issue? It will surface again as an open issue.")) return;
    setBusy(true);
    setErr(false);
    try {
      const r = await clientFetch(`/api/findings/${findingId}/reopen`, { method: "POST" });
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
      className={`shrink-0 rounded-full border font-medium disabled:opacity-60 ${pad}`}
      style={{ borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text-2)" }}
      title="Bring this issue back as an open issue"
    >
      {done ? "Recalled ✓" : busy ? "Recalling…" : err ? "Try again" : "Recall"}
    </button>
  );
}
