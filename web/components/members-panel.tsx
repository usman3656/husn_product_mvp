"use client";

import { useEffect, useState } from "react";

import { clientFetch, fetchMe, type Me } from "@/lib/api";

/* ============================================================
   Settings → Members — the admin directory (TENANCY.md D3/D5).
   Admin adds an email + role BEFORE the person logs in; login
   routes by email. Anti-monitoring: name / email / role /
   invited-or-active ONLY. No last-active, no usage data.
   ============================================================ */

type MemberRow = {
  id: number;
  email: string;
  name: string | null;
  role: "owner" | "admin" | "member";
  status: "invited" | "active";
};

export function MembersPanel() {
  const [me, setMe] = useState<Me | null>(null);
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add form
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchMe().then(setMe);
  }, []);

  const isAdmin =
    !me?.auth_required || me?.workspace?.role === "owner" || me?.workspace?.role === "admin";
  const isOwner = !me?.auth_required || me?.workspace?.role === "owner";

  useEffect(() => {
    if (!isAdmin) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function refresh() {
    try {
      const r = await clientFetch("/api/members");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as { items: MemberRow[] };
      setMembers(body.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const v = email.trim();
    if (!v || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await clientFetch("/api/members", {
        method: "POST",
        body: JSON.stringify({ email: v, role, notify }),
      });
      if (r.status === 409) {
        setError("That email is already in the directory.");
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setEmail("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "add failed");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(m: MemberRow, newRole: string) {
    const r = await clientFetch(`/api/members/${m.id}`, {
      method: "PATCH",
      body: JSON.stringify({ role: newRole }),
    });
    if (r.ok) await refresh();
    else setError((await r.json().catch(() => null))?.detail ?? "role change failed");
  }

  async function remove(m: MemberRow) {
    if (!confirm(`Remove ${m.email} from the workspace? Their sign-in stops immediately.`)) return;
    const r = await clientFetch(`/api/members/${m.id}`, { method: "DELETE" });
    if (r.ok) await refresh();
    else setError((await r.json().catch(() => null))?.detail ?? "remove failed");
  }

  if (me && !isAdmin) {
    return (
      <p className="text-[13.5px] px-5 py-4" style={{ color: "var(--muted)" }}>
        Membership is managed by your workspace admins.
      </p>
    );
  }

  return (
    <div>
      {/* Add member */}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 px-5 py-4 border-b husn-rule">
        <div className="flex-1 min-w-[220px]">
          <label htmlFor="m-email" className="husn-eyebrow" style={{ fontSize: 10 }}>
            Add a teammate by email
          </label>
          <input
            id="m-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="mt-1.5 w-full rounded-[10px] border px-3 py-2 text-[13.5px] focus:outline-none"
            style={{ borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text)" }}
          />
        </div>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "member")}
          aria-label="Role"
          className="rounded-[10px] border px-3 py-2 text-[13.5px]"
          style={{ borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text)" }}
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <label className="flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--muted)" }}>
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Email them a sign-in link
        </label>
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="rounded-full border px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
          style={{ background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }}
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </form>

      {error ? (
        <p className="px-5 pt-3 text-[12.5px]" style={{ color: "var(--danger-ink)" }}>{error}</p>
      ) : null}

      {/* Directory */}
      {members === null ? (
        <p className="px-5 py-4 text-[13px]" style={{ color: "var(--muted)" }}>Loading members…</p>
      ) : members.length === 0 ? (
        <p className="px-5 py-4 text-[13px]" style={{ color: "var(--muted)" }}>
          Just you so far. Add your teammates above — they sign in with their email and land here.
        </p>
      ) : (
        <ul>
          {members.map((m) => {
            const isSelf = me?.user?.email === m.email;
            return (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-3 px-5 py-3 border-b husn-rule"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium" style={{ color: "var(--text)" }}>
                    {m.name || m.email}
                    {isSelf ? <span style={{ color: "var(--muted)" }}> (you)</span> : null}
                  </p>
                  {m.name ? (
                    <p className="truncate text-[11.5px]" style={{ color: "var(--muted)" }}>{m.email}</p>
                  ) : null}
                </div>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium"
                  style={{
                    borderColor: m.status === "active" ? "var(--aligned-line)" : "var(--border)",
                    background: m.status === "active" ? "var(--aligned-soft)" : "var(--panel-2)",
                    color: m.status === "active" ? "var(--success-ink)" : "var(--muted)",
                  }}
                >
                  {m.status === "active" ? "Active" : "Invited — never signed in"}
                </span>
                <select
                  value={m.role}
                  onChange={(e) => changeRole(m, e.target.value)}
                  disabled={(m.role === "owner" && !isOwner) || isSelf}
                  aria-label={`Role for ${m.email}`}
                  className="rounded-[8px] border px-2 py-1 text-[12px] disabled:opacity-50"
                  style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  {isOwner || m.role === "owner" ? <option value="owner">Owner</option> : null}
                </select>
                <button
                  type="button"
                  onClick={() => remove(m)}
                  disabled={isSelf}
                  className="rounded-full border px-2.5 py-1 text-[11.5px] font-medium disabled:opacity-40"
                  style={{ borderColor: "var(--danger-line)", color: "var(--danger-ink)", background: "var(--danger-soft)" }}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
