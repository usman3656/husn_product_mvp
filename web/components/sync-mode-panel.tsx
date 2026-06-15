"use client";

import { useEffect, useState } from "react";

import { clientFetch, fetchMe, type Me } from "@/lib/api";

type SyncSettings = { mode: "manual" | "automatic"; interval_minutes: number; last_run_at: string | null };

/** Settings → Briefing: choose how ingestion runs. Manual (default) = only the
 * "Sync now" button refreshes. Automatic = the pipeline runs every N minutes.
 * Admin-editable; members see it read-only. Global (sync is process-wide). */
export function SyncModePanel() {
  const [s, setS] = useState<SyncSettings | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [interval, setIntervalMin] = useState(30);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchMe().then(setMe);
    clientFetch("/api/sync/settings")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: SyncSettings) => { setS(d); setIntervalMin(d.interval_minutes); })
      .catch(() => setErr("Couldn't load sync settings."));
  }, []);

  const isAdmin = !me?.auth_required || me?.workspace?.role === "owner" || me?.workspace?.role === "admin";

  async function save(mode: "manual" | "automatic", intervalMinutes: number) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await clientFetch("/api/sync/settings", {
        method: "PUT",
        body: JSON.stringify({ mode, interval_minutes: intervalMinutes }),
      });
      if (!r.ok) {
        const detail = await r.json().then((j) => j?.detail).catch(() => null);
        setErr(typeof detail === "string" ? detail : "Couldn't save. Try again.");
        return;
      }
      const d = (await r.json()) as SyncSettings;
      setS((prev) => ({ ...(prev as SyncSettings), mode: d.mode, interval_minutes: d.interval_minutes }));
      setMsg("Saved.");
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const auto = s?.mode === "automatic";

  return (
    <div className="flex flex-wrap items-start gap-4 px-5 py-4 husn-rule">
      <div className="min-w-[140px]">
        <p className="text-[13px] font-medium" style={{ color: "var(--text)" }}>Sync mode</p>
      </div>
      <div className="flex-1 min-w-0">
        {!s ? (
          <p className="text-[14px]" style={{ color: "var(--muted)" }}>{err ?? "…"}</p>
        ) : !isAdmin ? (
          <p className="text-[14px]" style={{ color: "var(--text-2)" }}>
            {auto ? `Automatic · every ${s.interval_minutes} min` : "Manual (Sync now only)"}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => save("manual", interval)}
                className="rounded-full border px-3 py-1.5 text-[13px] font-medium disabled:opacity-50"
                style={
                  !auto
                    ? { background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }
                    : { background: "var(--panel)", color: "var(--text-2)", borderColor: "var(--border-strong)" }
                }
              >
                Manual
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => save("automatic", interval)}
                className="rounded-full border px-3 py-1.5 text-[13px] font-medium disabled:opacity-50"
                style={
                  auto
                    ? { background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }
                    : { background: "var(--panel)", color: "var(--text-2)", borderColor: "var(--border-strong)" }
                }
              >
                Automatic
              </button>
            </div>

            {auto ? (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[13px]" style={{ color: "var(--muted)" }}>Every</span>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={interval}
                  onChange={(e) => setIntervalMin(Number(e.target.value))}
                  className="w-20 rounded-[8px] border px-2 py-1 text-[13px]"
                  style={{ borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text)" }}
                />
                <span className="text-[13px]" style={{ color: "var(--muted)" }}>minutes</span>
                <button
                  type="button"
                  disabled={busy || interval === s.interval_minutes}
                  onClick={() => save("automatic", interval)}
                  className="rounded-full border px-3 py-1 text-[12.5px] font-medium disabled:opacity-50"
                  style={{ borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent-ink)" }}
                >
                  Update interval
                </button>
              </div>
            ) : null}

            <p className="mt-2 text-[12.5px]" style={{ color: "var(--muted)" }}>
              {auto
                ? "Husn re-reads your sources and rebuilds the briefing on this interval. Lower intervals use more LLM quota."
                : "Nothing syncs automatically. Use the Sync now button on the briefing to refresh. (Conserves LLM quota.)"}
            </p>
            {err ? <p className="mt-2 text-[13px]" style={{ color: "var(--danger-ink)" }}>{err}</p> : null}
            {msg ? <p className="mt-2 text-[13px]" style={{ color: "var(--text-2)" }}>{msg}</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
