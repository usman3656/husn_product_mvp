"use client";

import { useEffect, useState } from "react";

import { fetchMe, type Me } from "@/lib/api";

/** Settings → Account — who am I, which workspace, what role. Live, not
 * hardcoded. Renders quietly in bridge mode when no session exists. */
export function AccountPanel() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetchMe().then(setMe);
  }, []);

  const rows: { label: string; value: string }[] = me?.authenticated
    ? [
        { label: "Signed in as", value: me.user?.email ?? "—" },
        { label: "Workspace", value: me.workspace?.name ?? "No workspace selected" },
        { label: "Your role", value: me.workspace?.role ?? "—" },
      ]
    : [{ label: "Signed in as", value: me === null ? "…" : "Not signed in" }];

  return (
    <>
      {rows.map((r) => (
        <div key={r.label} className="flex flex-wrap items-start gap-4 px-5 py-4 husn-rule">
          <div className="min-w-[140px]">
            <p className="text-[13px] font-medium" style={{ color: "var(--text)" }}>{r.label}</p>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px]" style={{ color: "var(--text-2)" }}>{r.value}</p>
          </div>
        </div>
      ))}
    </>
  );
}
