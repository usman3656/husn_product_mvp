"use client";

import { useMemo, useState } from "react";

import { ReachOutButton, type ReachOutContext } from "@/components/reach-out";

/* ============================================================
   CriticalPeople — interactive: hover/click reveals identities
   and what they own; inline Reach Out For Me.
   ============================================================ */

export type CriticalPerson = {
  id: number;
  name: string;
  email: string | null;
  initials: string;
  identities: { source: string; display_name: string | null; email: string | null }[];
  /** Open findings that mention this person as a possible owner. */
  ownershipLoad: number;
  /** Editorial blurb summarising what they touch. */
  touches: string;
};

const SOURCE_LABEL: Record<string, string> = { jira: "Jira", slack: "Slack", google: "Google", microsoft: "Microsoft" };

export function CriticalPeople({ people }: { people: CriticalPerson[] }) {
  const [openId, setOpenId] = useState<number | null>(null);

  const sorted = useMemo(
    () => [...people].sort((a, b) => b.ownershipLoad - a.ownershipLoad || a.name.localeCompare(b.name)),
    [people],
  );

  if (sorted.length === 0) {
    return (
      <div
        className="rounded-[var(--radius)] border border-dashed px-6 py-10"
        style={{ borderColor: "var(--border-strong)", background: "var(--panel-2)" }}
      >
        <p className="text-[14.5px] font-medium">No one is on Husn's radar yet.</p>
        <p className="mt-2 text-[13px]" style={{ color: "var(--muted)" }}>
          People appear here as soon as Husn reads activity and resolves them across tools.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {sorted.map((p) => (
        <li key={p.id}>
          <PersonCard
            person={p}
            isOpen={openId === p.id}
            onToggle={() => setOpenId(openId === p.id ? null : p.id)}
          />
        </li>
      ))}
    </ul>
  );
}

function PersonCard({
  person,
  isOpen,
  onToggle,
}: {
  person: CriticalPerson;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const heat: "high" | "medium" | "low" =
    person.ownershipLoad >= 3 ? "high" :
    person.ownershipLoad >= 1 ? "medium" : "low";
  const heatColor =
    heat === "high" ? "var(--conflict)" :
    heat === "medium" ? "var(--uncertain)" :
    "var(--aligned)";
  const heatSoft =
    heat === "high" ? "var(--conflict-soft)" :
    heat === "medium" ? "var(--uncertain-soft)" :
    "var(--aligned-soft)";

  const ctx: ReachOutContext = {
    who: person.name,
    whoHandle: person.email ?? undefined,
    why: `${person.name} appears across ${person.identities.length} ${person.identities.length === 1 ? "tool" : "tools"} and ${person.ownershipLoad > 0 ? `is named in ${person.ownershipLoad} open ${person.ownershipLoad === 1 ? "ownership question" : "ownership questions"}` : "is active in the workstreams Husn is watching"}.`,
    about: `${person.name} — ${person.touches}`,
    draft: `Hey ${person.name.split(" ")[0]} — quick one. Could you give me a read on where things are with the items you're tracking? Trying to align before the next planning cycle.`,
    via: "slack",
  };

  return (
    <article
      className="rounded-[var(--radius)] border transition-shadow"
      style={{
        borderColor: isOpen ? heatColor : "var(--border)",
        background: "var(--panel)",
        boxShadow: isOpen ? "var(--shadow-md)" : "var(--shadow-xs)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="block w-full p-4 text-left"
        aria-expanded={isOpen}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="relative grid h-10 w-10 place-items-center rounded-full shrink-0"
            style={{ background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)" }}
          >
            <span className="text-[12.5px] font-semibold">{person.initials}</span>
            {person.ownershipLoad > 0 ? (
              <span
                className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full text-[9px] font-semibold tabular husn-pulse"
                style={{ width: 16, height: 16, background: heatColor, color: "#fff", boxShadow: `0 0 0 3px ${heatSoft}` }}
                aria-label={`${person.ownershipLoad} open ownership question${person.ownershipLoad === 1 ? "" : "s"}`}
              >
                {person.ownershipLoad}
              </span>
            ) : null}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-medium" style={{ color: "var(--text)" }}>{person.name}</p>
            {person.email ? <p className="truncate text-[12px]" style={{ color: "var(--muted)" }}>{person.email}</p> : null}
            <p className="mt-1 text-[12.5px] truncate" style={{ color: "var(--text-2)" }}>{person.touches}</p>
          </div>
          <span aria-hidden className="text-[12px] shrink-0" style={{ color: "var(--muted-2)" }}>
            {isOpen ? "▾" : "▸"}
          </span>
        </div>
      </button>

      {isOpen ? (
        <div className="px-4 pb-4">
          <div className="border-t pt-3 mt-1" style={{ borderColor: "var(--rule)" }}>
            <p className="husn-eyebrow" style={{ fontSize: 10 }}>Identities resolved</p>
            <ul className="mt-2 space-y-1">
              {person.identities.map((idt, i) => (
                <li key={i} className="flex items-center gap-2 text-[12.5px]">
                  <span
                    className="font-mono rounded-md border px-1.5 py-0.5 text-[10px]"
                    style={{ borderColor: "var(--border)", background: "var(--panel-2)", color: "var(--muted)" }}
                  >
                    {SOURCE_LABEL[idt.source] ?? idt.source}
                  </span>
                  <span className="truncate" style={{ color: "var(--text-2)" }}>
                    {idt.display_name || idt.email || "—"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <ReachOutButton context={ctx} variant="secondary" size="sm" />
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
