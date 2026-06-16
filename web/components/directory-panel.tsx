"use client";

import { useEffect, useState } from "react";

import { clientFetch, fetchMe, type Me } from "@/lib/api";

type Contact = { id: number; name: string; email: string | null; slack_user_id: string | null };

/** Settings → People (admin only): the CURATED team directory the Slack bot
 * emails people from. Add / edit / delete, or import the workspace members.
 * Not the full ingested person list. */
export function DirectoryPanel() {
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<Contact[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | "new" | "import" | null>(null);
  const [nName, setNName] = useState("");
  const [nEmail, setNEmail] = useState("");
  const [nSlack, setNSlack] = useState("");

  const isAdmin = !me?.auth_required || me?.workspace?.role === "owner" || me?.workspace?.role === "admin";

  async function refresh() {
    try {
      const r = await clientFetch("/api/directory");
      if (!r.ok) { setErr("Couldn't load the directory."); return; }
      setItems(((await r.json()) as { items: Contact[] }).items);
      setErr(null);
    } catch { setErr("Couldn't load the directory."); }
  }

  useEffect(() => {
    fetchMe().then((m) => {
      setMe(m);
      const admin = !m?.auth_required || m?.workspace?.role === "owner" || m?.workspace?.role === "admin";
      if (admin) refresh();
    });
  }, []);

  if (me === null) return <Row label="People"><span style={{ color: "var(--muted)" }}>…</span></Row>;
  if (!isAdmin) return <Row label="People"><span style={{ color: "var(--muted)" }}>Only workspace admins can manage the directory.</span></Row>;

  async function patch(c: Contact, field: "email" | "slack_user_id", value: string) {
    if ((c[field] ?? "") === value) return;
    setBusy(c.id);
    try {
      const r = await clientFetch(`/api/directory/${c.id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) });
      if (r.ok) setItems((p) => (p ?? []).map((x) => (x.id === c.id ? { ...x, [field]: value || null } : x)));
    } finally { setBusy(null); }
  }

  async function remove(c: Contact) {
    if (!confirm(`Remove ${c.name} from the directory?`)) return;
    setBusy(c.id);
    try {
      const r = await clientFetch(`/api/directory/${c.id}`, { method: "DELETE" });
      if (r.ok) setItems((p) => (p ?? []).filter((x) => x.id !== c.id));
    } finally { setBusy(null); }
  }

  async function add() {
    const name = nName.trim();
    if (!name || busy === "new") return;
    setBusy("new");
    try {
      const r = await clientFetch("/api/directory", { method: "POST", body: JSON.stringify({ name, email: nEmail.trim() || null, slack_user_id: nSlack.trim() || null }) });
      if (r.ok) { setNName(""); setNEmail(""); setNSlack(""); await refresh(); }
    } finally { setBusy(null); }
  }

  async function importMembers() {
    if (busy === "import") return;
    setBusy("import");
    try {
      const r = await clientFetch("/api/directory/import", { method: "POST" });
      if (r.ok) await refresh();
    } finally { setBusy(null); }
  }

  const input = "rounded-[8px] border px-2 py-1 text-[13px]";
  const inputStyle = { borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text)" } as const;

  return (
    <Row label="Team directory">
      <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
        The people the Slack bot can email. Add a name + email (and Slack ID if you have it).
      </p>
      {err ? <p className="mt-2 text-[13px]" style={{ color: "var(--danger-ink)" }}>{err}</p> : null}

      <div className="mt-3 space-y-1.5">
        {(items ?? []).map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] min-w-[110px]" style={{ color: "var(--text)" }}>{c.name}</span>
            <input type="email" defaultValue={c.email ?? ""} placeholder="email@company.com"
              onBlur={(e) => patch(c, "email", e.target.value.trim())}
              className={`flex-1 min-w-[170px] ${input}`} style={inputStyle} />
            <input defaultValue={c.slack_user_id ?? ""} placeholder="Slack ID (U…)"
              onBlur={(e) => patch(c, "slack_user_id", e.target.value.trim())}
              className={`w-[120px] font-mono ${input}`} style={inputStyle} />
            <button type="button" onClick={() => remove(c)} disabled={busy === c.id}
              className="text-[12px] font-medium disabled:opacity-50" style={{ color: "var(--danger-ink)" }}>
              {busy === c.id ? "…" : "Delete"}
            </button>
          </div>
        ))}
        {items && items.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--muted)" }}>No one yet. Import your workspace members or add someone below.</p>
        ) : null}
      </div>

      {/* Add */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={nName} onChange={(e) => setNName(e.target.value)} placeholder="Name" className={`min-w-[110px] ${input}`} style={inputStyle} />
        <input type="email" value={nEmail} onChange={(e) => setNEmail(e.target.value)} placeholder="email@company.com" className={`min-w-[170px] ${input}`} style={inputStyle} />
        <input value={nSlack} onChange={(e) => setNSlack(e.target.value)} placeholder="Slack ID (optional)" className={`w-[120px] font-mono ${input}`} style={inputStyle} />
        <button type="button" onClick={add} disabled={!nName.trim() || busy === "new"}
          className="rounded-full border px-3 py-1 text-[12.5px] font-medium disabled:opacity-50"
          style={{ background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }}>
          {busy === "new" ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={importMembers} disabled={busy === "import"}
          className="rounded-full border px-3 py-1 text-[12.5px] font-medium disabled:opacity-50"
          style={{ borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent-ink)" }}>
          {busy === "import" ? "Importing…" : "Import members"}
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
