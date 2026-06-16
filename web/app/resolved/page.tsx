import { RecallButton } from "@/components/recall-button";
import { serverJson } from "@/lib/api";

export const metadata = {
  title: "Resolved · Husn",
  description: "Issues you've marked as dealt with — kept, not deleted, and recallable.",
};

type ResolvedFinding = {
  id: number;
  rule_id: string;
  severity: "low" | "medium" | "high";
  summary: string;
  details: { kind?: string; key?: string; distinct_values?: string[] } | null;
  opened_at: string;
  resolved_at: string;
  resolved_by: string | null;
};

const SEV_TONE: Record<string, string> = {
  high: "var(--danger)",
  medium: "var(--warning)",
  low: "var(--muted)",
};

function fmtDate(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default async function ResolvedPage() {
  const data = await serverJson<{ items: ResolvedFinding[] }>("/api/findings/resolved?limit=200");
  const items = data?.items ?? [];

  return (
    <main className="mx-auto px-6 lg:px-10 py-12" style={{ maxWidth: 880 }}>
      <p className="husn-eyebrow">Resolved</p>
      <h1 className="husn-title mt-3">Dealt with</h1>
      <p className="husn-prose mt-3 max-w-[62ch]">
        Issues you marked as handled. They no longer count against your confidence
        or appear in the briefing — but they&rsquo;re kept here, not deleted. An
        issue resurfaces on its own if the underlying conflict changes; recall one
        to bring it back as open right now.
      </p>

      {items.length === 0 ? (
        <div
          className="mt-10 rounded-[var(--radius)] border px-5 py-10 text-center"
          style={{ borderColor: "var(--border)", background: "var(--panel)" }}
        >
          <p className="text-[14px]" style={{ color: "var(--muted)" }}>
            Nothing resolved yet. When you mark an issue &ldquo;dealt with,&rdquo; it lands here.
          </p>
        </div>
      ) : (
        <ul className="mt-8 space-y-2.5">
          {items.map((f) => (
            <li
              key={f.id}
              className="flex items-start gap-4 rounded-[var(--radius)] border px-5 py-4"
              style={{ borderColor: "var(--border)", background: "var(--panel)" }}
            >
              <span
                aria-hidden
                title={`${f.severity} severity`}
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ background: SEV_TONE[f.severity] ?? "var(--muted)" }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-medium" style={{ color: "var(--text)" }}>
                  {f.summary}
                </p>
                <p className="mt-1 husn-meta">
                  Resolved {fmtDate(f.resolved_at)}
                  {f.resolved_by ? ` · by ${f.resolved_by}` : ""} · {f.rule_id}
                </p>
              </div>
              <RecallButton findingId={f.id} size="sm" />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
