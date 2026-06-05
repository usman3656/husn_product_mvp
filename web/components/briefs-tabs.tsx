"use client";

import { useMemo, useState } from "react";

import { EvidenceChip, Pill } from "@/components/ui";

type Bullet = { text: string; claim_ids: number[] };
type ConflictRendered = {
  conflict_id: number;
  text: string;
  claim_ids: number[];
};
type BriefContent = {
  headline: string;
  bullets: Bullet[];
  conflicts_rendered?: ConflictRendered[];
  fallback_used?: boolean;
  prompt_version?: number;
};

export type BriefForTabs = {
  id: number;
  persona: string;
  generated_at: string;
  content: BriefContent;
  source_claim_ids: number[];
};

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "just now";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const PERSONA_ORDER = ["TPM", "Eng Manager", "QA Lead", "Security Lead", "Ops Manager"];

function sortPersonas(personas: string[]): string[] {
  const ordered: string[] = [];
  for (const p of PERSONA_ORDER) if (personas.includes(p)) ordered.push(p);
  for (const p of personas) if (!ordered.includes(p)) ordered.push(p);
  return ordered;
}

export function BriefsTabs({ briefs }: { briefs: BriefForTabs[] }) {
  // latest brief per persona
  const latest = useMemo(() => {
    const m = new Map<string, BriefForTabs>();
    for (const b of briefs) if (!m.has(b.persona)) m.set(b.persona, b);
    return m;
  }, [briefs]);

  const personas = useMemo(() => sortPersonas(Array.from(latest.keys())), [latest]);
  const [active, setActive] = useState<string | null>(personas[0] ?? null);

  if (personas.length === 0 || active === null) return null;
  const brief = latest.get(active)!;
  const conflicts = brief.content.conflicts_rendered ?? [];

  return (
    <div className="mt-4">
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Personas"
        className="-mx-1 flex flex-wrap gap-1.5"
      >
        {personas.map((p) => {
          const isActive = p === active;
          return (
            <button
              key={p}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(p)}
              className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors duration-150"
              style={{
                borderColor: isActive ? "var(--accent)" : "var(--border)",
                background: isActive ? "var(--accent-soft)" : "transparent",
                color: isActive ? "var(--accent-ink)" : "var(--muted)",
              }}
            >
              {p}
            </button>
          );
        })}
      </div>

      {/* Selected brief */}
      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[14px] font-semibold leading-snug">
            {brief.content.headline || `Brief for ${brief.persona}`}
          </h3>
          <span className="shrink-0 text-[11px]" style={{ color: "var(--muted)" }}>
            {timeAgo(brief.generated_at)}
          </span>
        </div>

        {brief.content.fallback_used && (
          <p className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
            Rendered from a deterministic template after the LLM did not pass verification.
          </p>
        )}

        {brief.content.bullets.length > 0 && (
          <ul className="mt-3 space-y-2 text-[12.5px] leading-relaxed">
            {brief.content.bullets.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden style={{ color: "var(--muted)" }}>•</span>
                <span>
                  {b.text}{" "}
                  {b.claim_ids.length > 0 && (
                    <EvidenceChip
                      source="Source"
                      cite={`#${b.claim_ids.join(", ")}`}
                      tone="accent"
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {conflicts.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 flex items-center gap-2 text-[11px]">
              <Pill tone="danger">Conflicts in this brief</Pill>
              <span style={{ color: "var(--muted)" }}>
                {conflicts.length} referenced
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {conflicts.map((c) => (
                <article
                  key={c.conflict_id}
                  className="rounded-xl border p-3"
                  style={{
                    borderColor: "var(--danger-line)",
                    background: "var(--danger-soft)",
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p
                      className="text-[10px] font-semibold uppercase tracking-wide"
                      style={{ color: "var(--danger-ink)" }}
                    >
                      Finding #{c.conflict_id}
                    </p>
                    <EvidenceChip
                      source="Claims"
                      cite={`#${c.claim_ids.join(", ")}`}
                      tone="danger"
                    />
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed">
                    {c.text || "(conflict surfaced; render fell back)"}
                  </p>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
