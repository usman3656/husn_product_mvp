"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { clientFetch } from "@/lib/api";

/* /login/select — workspace picker for emails that belong to more than one
   company (consultant case). Memberships are handed over from the confirm
   page via sessionStorage; if absent (deep link), we re-derive from /auth/me
   being workspace-less and just send them back to login. */

type PickerMembership = { tenant_id: number; name: string; slug: string; role: string };

export default function SelectWorkspacePage() {
  const router = useRouter();
  const [memberships, setMemberships] = useState<PickerMembership[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("husn.picker");
      if (raw) {
        setMemberships(JSON.parse(raw) as PickerMembership[]);
        return;
      }
    } catch {}
    router.replace("/login");
  }, [router]);

  async function pick(tenant_id: number) {
    if (busy != null) return;
    setBusy(tenant_id);
    try {
      const r = await clientFetch("/auth/workspace/select", {
        method: "POST",
        body: JSON.stringify({ tenant_id }),
      });
      if (r.ok) {
        sessionStorage.removeItem("husn.picker");
        router.replace("/");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full husn-rise" style={{ maxWidth: 440 }}>
        <h1 className="husn-title">Choose a workspace.</h1>
        <p className="husn-prose mt-3" style={{ fontSize: 15 }}>
          Your email belongs to more than one company on Husn.
        </p>
        <ul className="mt-8 space-y-2">
          {(memberships ?? []).map((m) => (
            <li key={m.tenant_id}>
              <button
                type="button"
                onClick={() => pick(m.tenant_id)}
                disabled={busy != null}
                className="w-full rounded-[var(--radius)] border px-5 py-4 text-left husn-lift disabled:opacity-60"
                style={{ borderColor: "var(--border)", background: "var(--panel)" }}
              >
                <p className="text-[15px] font-semibold">{m.name}</p>
                <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--muted)" }}>
                  {m.role} · {m.slug}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
