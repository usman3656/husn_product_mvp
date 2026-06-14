"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { clientFetch } from "@/lib/api";

/* ============================================================
   /login — the front door.
   Two methods:
     • Magic link (default) — enter email, get a one-time link.
     • Password — username + password, for users who set one up
       in Settings. Magic link stays the recovery path.
   ============================================================ */

type LoginResult =
  | { status: "ok"; workspace: { tenant_id: number; name: string; role: string } }
  | { status: "pick_workspace"; memberships: { tenant_id: number; name: string; slug: string; role: string }[] }
  | { status: "no_workspace"; email: string };

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"magic" | "password">("magic");

  // magic-link state
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  // password state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitMagic(e: React.FormEvent) {
    e.preventDefault();
    const v = email.trim();
    if (!v || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await clientFetch("/auth/login/magic", {
        method: "POST",
        body: JSON.stringify({ email: v }),
      });
      const bodyText = await r.text().catch(() => "");
      if (!r.ok) {
        throw new Error(`HTTP ${r.status} — ${bodyText.slice(0, 200) || "(no body)"}`);
      }
      setSent(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Couldn't send the link: ${msg}`);
      // eslint-disable-next-line no-console
      console.error("[husn login] send failed", err);
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    const u = username.trim();
    if (!u || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await clientFetch("/auth/login/password", {
        method: "POST",
        body: JSON.stringify({ username: u, password }),
      });
      if (!r.ok) {
        if (r.status === 429) setError("Too many attempts. Wait a few minutes and try again.");
        else if (r.status === 401) setError("Incorrect username or password.");
        else setError("Something went wrong. Try again.");
        return;
      }
      const data = (await r.json()) as LoginResult;
      if (data.status === "ok") {
        sessionStorage.removeItem("husn.picker");
        router.replace("/");
      } else if (data.status === "pick_workspace") {
        sessionStorage.setItem("husn.picker", JSON.stringify(data.memberships));
        router.replace("/login/select");
      } else {
        router.replace("/welcome");
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: "magic" | "password") {
    setMode(next);
    setError(null);
  }

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full husn-rise" style={{ maxWidth: 420 }}>
        {/* Mark */}
        <div className="flex items-center gap-2.5 mb-10">
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-[9px]"
            style={{ background: "var(--text)", color: "var(--bg)" }}
          >
            <span className="text-[14px] font-semibold leading-none" style={{ letterSpacing: "-0.04em" }}>h</span>
          </span>
          <span className="text-[16px] font-semibold tracking-tight">husn</span>
        </div>

        {sent ? (
          <div>
            <h1 className="husn-title">Check your email.</h1>
            <p className="husn-prose mt-4">
              We sent a sign-in link to <strong style={{ color: "var(--text)" }}>{email.trim()}</strong>.
              It works once and expires in 15 minutes.
            </p>
            <button
              type="button"
              onClick={() => setSent(false)}
              className="mt-8 text-[13.5px] font-medium"
              style={{ color: "var(--muted)" }}
            >
              ← Use a different email
            </button>
          </div>
        ) : mode === "magic" ? (
          <div>
            <h1 className="husn-title">Sign in to Husn.</h1>
            <p className="husn-prose mt-3" style={{ fontSize: 15 }}>
              The intelligence layer for your organization. Enter your work
              email — we&apos;ll send you a one-time sign-in link.
            </p>

            <form onSubmit={submitMagic} className="mt-8">
              <label htmlFor="email" className="husn-eyebrow" style={{ fontSize: 10.5 }}>
                Work email
              </label>
              <input
                id="email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="mt-2 w-full rounded-[12px] border px-4 py-3 text-[15px] focus:outline-none"
                style={{
                  borderColor: "var(--border-strong)",
                  background: "var(--panel)",
                  color: "var(--text)",
                }}
              />
              <button
                type="submit"
                disabled={busy || !email.trim()}
                className="mt-4 w-full rounded-full border px-4 py-3 text-[14.5px] font-semibold disabled:opacity-50"
                style={{ background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }}
              >
                {busy ? "Sending…" : "Send sign-in link"}
              </button>
            </form>

            {error ? (
              <p className="mt-4 text-[13px]" style={{ color: "var(--danger-ink)" }}>{error}</p>
            ) : null}

            <button
              type="button"
              onClick={() => switchMode("password")}
              className="mt-6 text-[13px] font-medium"
              style={{ color: "var(--accent)" }}
            >
              Sign in with a password instead
            </button>

            <p className="mt-8 text-[12.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
              New here? Sign in with your email and you&apos;ll be able to create
              your company&apos;s workspace. If your team already uses Husn, ask
              your admin to add your email first.
            </p>
          </div>
        ) : (
          <div>
            <h1 className="husn-title">Sign in with a password.</h1>
            <p className="husn-prose mt-3" style={{ fontSize: 15 }}>
              Use the username and password you set up in Settings.
            </p>

            <form onSubmit={submitPassword} className="mt-8">
              <label htmlFor="username" className="husn-eyebrow" style={{ fontSize: 10.5 }}>
                Username
              </label>
              <input
                id="username"
                type="text"
                required
                autoFocus
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your-username"
                className="mt-2 w-full rounded-[12px] border px-4 py-3 text-[15px] focus:outline-none"
                style={{
                  borderColor: "var(--border-strong)",
                  background: "var(--panel)",
                  color: "var(--text)",
                }}
              />
              <label htmlFor="password" className="husn-eyebrow mt-4 block" style={{ fontSize: 10.5 }}>
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-2 w-full rounded-[12px] border px-4 py-3 text-[15px] focus:outline-none"
                style={{
                  borderColor: "var(--border-strong)",
                  background: "var(--panel)",
                  color: "var(--text)",
                }}
              />
              <button
                type="submit"
                disabled={busy || !username.trim() || !password}
                className="mt-4 w-full rounded-full border px-4 py-3 text-[14.5px] font-semibold disabled:opacity-50"
                style={{ background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }}
              >
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>

            {error ? (
              <p className="mt-4 text-[13px]" style={{ color: "var(--danger-ink)" }}>{error}</p>
            ) : null}

            <button
              type="button"
              onClick={() => switchMode("magic")}
              className="mt-6 text-[13px] font-medium"
              style={{ color: "var(--accent)" }}
            >
              Sign in with an email link instead
            </button>

            <p className="mt-8 text-[12.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
              Forgot your password? Sign in with an email link, then set a new
              one in Settings → Account.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
