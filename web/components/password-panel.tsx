"use client";

import { useEffect, useState } from "react";

import { clientFetch, fetchMe, type Me } from "@/lib/api";

/** Settings → Account — set up (once) or change the username+password
 * credential. Username is immutable after setup; the email magic link stays
 * the recovery path. Mirrors the husn-rule row layout used by AccountPanel. */
export function PasswordPanel() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetchMe().then(setMe);
  }, []);

  // Loading / not signed in — stay quiet, AccountPanel already covers identity.
  if (me === null) return <Row label="Password" value="…" />;
  if (!me.authenticated) return null;

  const hasUsername = !!me.user?.username;

  return hasUsername ? (
    <ChangePassword username={me.user!.username!} />
  ) : (
    <SetupPassword onDone={() => fetchMe().then(setMe)} />
  );
}

function Row({ label, children, value }: { label: string; children?: React.ReactNode; value?: string }) {
  return (
    <div className="flex flex-wrap items-start gap-4 px-5 py-4 husn-rule">
      <div className="min-w-[140px]">
        <p className="text-[13px] font-medium" style={{ color: "var(--text)" }}>{label}</p>
      </div>
      <div className="flex-1 min-w-0">
        {value !== undefined ? (
          <p className="text-[14px]" style={{ color: "var(--text-2)" }}>{value}</p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

const inputCls = "w-full max-w-[320px] rounded-[10px] border px-3 py-2 text-[14px] focus:outline-none";
const inputStyle = {
  borderColor: "var(--border-strong)",
  background: "var(--panel)",
  color: "var(--text)",
} as const;
const btnCls = "rounded-full border px-4 py-2 text-[13px] font-semibold disabled:opacity-50";
const btnStyle = { background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" } as const;

async function errorText(r: Response): Promise<string> {
  try {
    const j = await r.json();
    if (j && typeof j.detail === "string") return j.detail;
  } catch {
    /* fall through */
  }
  return "Something went wrong. Try again.";
}

function SetupPassword({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setMsg(null);
    if (password !== confirm) {
      setErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const r = await clientFetch("/auth/password/setup", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!r.ok) {
        setErr(await errorText(r));
        return;
      }
      setMsg("Username and password set. You can now sign in with them.");
      setPassword("");
      setConfirm("");
      onDone();
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Row label="Password sign-in">
      <p className="text-[13px]" style={{ color: "var(--muted)" }}>
        Set up a username and password so you can sign in without an email link.
        Your username can&apos;t be changed later.
      </p>
      <form onSubmit={submit} className="mt-3 space-y-2">
        <input
          aria-label="Username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Choose a username"
          className={inputCls}
          style={inputStyle}
        />
        <input
          aria-label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password (min 8 characters)"
          className={inputCls}
          style={inputStyle}
        />
        <input
          aria-label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm password"
          className={inputCls}
          style={inputStyle}
        />
        <button
          type="submit"
          disabled={busy || !username.trim() || !password || !confirm}
          className={btnCls}
          style={btnStyle}
        >
          {busy ? "Saving…" : "Set up password sign-in"}
        </button>
      </form>
      {err ? <p className="mt-2 text-[13px]" style={{ color: "var(--danger-ink)" }}>{err}</p> : null}
      {msg ? <p className="mt-2 text-[13px]" style={{ color: "var(--text-2)" }}>{msg}</p> : null}
    </Row>
  );
}

function ChangePassword({ username }: { username: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setMsg(null);
    if (next !== confirm) {
      setErr("New passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const r = await clientFetch("/auth/password/change", {
        method: "POST",
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      if (!r.ok) {
        setErr(await errorText(r));
        return;
      }
      setMsg("Password updated.");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Row label="Username" value={username}>
        <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted)" }}>
          Your username can&apos;t be changed.
        </p>
      </Row>
      <Row label="Password">
        <form onSubmit={submit} className="space-y-2">
          <input
            aria-label="Current password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Current password"
            className={inputCls}
            style={inputStyle}
          />
          <input
            aria-label="New password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="New password (min 8 characters)"
            className={inputCls}
            style={inputStyle}
          />
          <input
            aria-label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            className={inputCls}
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={busy || !current || !next || !confirm}
            className={btnCls}
            style={btnStyle}
          >
            {busy ? "Updating…" : "Change password"}
          </button>
        </form>
        {err ? <p className="mt-2 text-[13px]" style={{ color: "var(--danger-ink)" }}>{err}</p> : null}
        {msg ? <p className="mt-2 text-[13px]" style={{ color: "var(--text-2)" }}>{msg}</p> : null}
      </Row>
    </>
  );
}
