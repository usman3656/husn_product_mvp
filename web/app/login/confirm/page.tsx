"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { clientFetch } from "@/lib/api";

/* ============================================================
   /login/confirm?token=… — the magic-link landing page.
   Deliberately requires a click (POST) so email scanners that
   prefetch GET links can't burn the single-use token.
   After verification, forks on the membership state:
     ok             → /            (straight into the workspace)
     pick_workspace → /login/select
     no_workspace   → /welcome
   ============================================================ */

type ConsumeResult =
  | { status: "ok"; workspace: { tenant_id: number; name: string; role: string } }
  | { status: "pick_workspace"; memberships: { tenant_id: number; name: string; slug: string; role: string }[] }
  | { status: "no_workspace"; email: string };

function ConfirmInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await clientFetch("/auth/login/magic/consume", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      if (!r.ok) {
        setError(
          r.status === 400
            ? "This link is invalid or has expired. Request a new one."
            : "Something went wrong. Try again.",
        );
        return;
      }
      const data = (await r.json()) as ConsumeResult;
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

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full husn-rise" style={{ maxWidth: 420 }}>
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

        {!token ? (
          <div>
            <h1 className="husn-title">Missing sign-in token.</h1>
            <p className="husn-prose mt-4">
              Open the link from your email again, or{" "}
              <a href="/login" style={{ color: "var(--accent)" }} className="font-medium">request a new one</a>.
            </p>
          </div>
        ) : (
          <div>
            <h1 className="husn-title">Almost there.</h1>
            <p className="husn-prose mt-3" style={{ fontSize: 15 }}>
              Click below to finish signing in. This confirms the link was
              opened by you, not by an email scanner.
            </p>
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="mt-8 w-full rounded-full border px-4 py-3 text-[14.5px] font-semibold disabled:opacity-50"
              style={{ background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }}
            >
              {busy ? "Signing in…" : "Sign in to Husn"}
            </button>
            {error ? (
              <p className="mt-4 text-[13px]" style={{ color: "var(--danger-ink)" }}>
                {error}{" "}
                <a href="/login" style={{ color: "var(--accent)" }} className="font-medium">New link →</a>
              </p>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense>
      <ConfirmInner />
    </Suspense>
  );
}
