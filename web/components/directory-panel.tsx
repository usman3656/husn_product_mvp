"use client";

import { useEffect, useState } from "react";

import { clientFetch, fetchMe, type Me } from "@/lib/api";

type Person = { id: number; name: string; email: string | null; slack_ids: string[] };

/** Settings → People directory (admin only). Names ↔ emails ↔ Slack IDs — what
 * the Slack bot resolves recipients against when you say "email <person>".
 * Editing an email here immediately improves the bot's resolution. */
export function DirectoryPanel() {
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<Person[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | "new" | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const isAdmin = !me?.auth_required || me?.workspace?.role === "owner" || me?.workspace?.role === "admin";

  async function refresh() {
    try {
      const r = await clientFetch("/api/directory");
      if (!r.ok) { setErr("Couldn't load the directory."); return; }
      setItems(((await r.json()) as { items: Person[] }).items);
      setErr(null);
    } catch {
      setErr("Couldn't load the directory.");
    }
  }

  useEffect(() => {
    fetchMe().then((m) => {
      setMe(m);
      const admin = !m?.auth_required || m?.workspace?.role === "owner" || m?.workspace?.role === "admin";
      if (admin) refresh();
    });
  }, []);

  if (me === null) return <Row label="People"><span style={{ color: "var(--muted)" }}>…</span></Row>;
  if (!isAdmin) {
    return <Row label="People"><span style={{ color: "var(--muted)" }}>Only workspace admins can manage the directory.</span></Row>;
  }

  async function saveEmail(p: Person, email: string) {
    if ((p.email ?? "") === email) return;
    setSavingId(p.id);
    try {
      const r = await clientFetch(`/api/directory/${p.id}`, { method: "PATCH", body: JSON.stringify({ email }) });
      if (r.ok) setItems((prev) => (prev ?? []).map((x) => (x.id === p.id ? { ...x, email: email || null } : x)));
    } finally {
      setSavingId(null);
    }
  }

  async function addPerson() {
    const name = newName.trim();
    if (!name || savingId === "new") return;
    setSavingId("new");
    try {
      const r = await clientFetch("/api/directory", { method: "POST", body: JSON.stringify({ name, email: newEmail.trim() || null }) });
      if (r.ok) { setNewName(""); setNewEmail(""); await refresh(); }
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Row label="People directory">
      <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
        The Slack bot emails people from this list. Add or fix an email and it can reach them.
      </p>
      {err ? <p className="mt-2 text-[13px]" style={{ color: "var(--danger-ink)" }}>{err}</p> : null}

      <div className="mt-3 space-y-1.5">
        {(items ?? []).map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] min-w-[120px]" style={{ color: "var(--text)" }}>{p.name}</span>
            <span className="text-[11px] font-mono" style={{ color: "var(--muted-2)" }}>
              {p.slack_ids.length ? p.slack_ids.join(", ") : "—"}
            </span>
            <input
              type="email"
              defaultValue={p.email ?? ""}
              placeholder="email@company.com"
              onBlur={(e) => saveEmail(p, e.target.value.trim())}
              className="flex-1 min-w-[180px] rounded-[8px] border px-2 py-1 text-[13px]"
              style={{ borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text)" }}
            />
            {savingId === p.id ? <span className="text-[11px]" style={{ color: "var(--muted)" }}>saving…</span> : null}
          </div>
        ))}
        {items && items.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--muted)" }}>No people yet — add one below or connect a tool to populate it.</p>
        ) : null}
      </div>

      {/* Add a contact */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Name"
          className="min-w-[120px] rounded-[8px] border px-2 py-1 text-[13px]"
          style={{ borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text)" }}
        />
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="email@company.com"
          className="min-w-[180px] rounded-[8px] border px-2 py-1 text-[13px]"
          style={{ borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text)" }}
        />
        <button
          type="button"
          onClick={addPerson}
          disabled={!newName.trim() || savingId === "new"}
          className="rounded-full border px-3 py-1 text-[12.5px] font-medium disabled:opacity-50"
          style={{ background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }}
        >
          {savingId === "new" ? "Adding…" : "Add"}
        </button>
      </div>
    </Row>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-4 px-5 py-4 husn-rule">
      <div className="min-w-[140px]">
        <p className="text-[13px] font-medium" style={{ color: "var(--text)" }}>{label}</p>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
