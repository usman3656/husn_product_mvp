import { ApiHealth } from "@/components/api-health";
import { BriefsCard } from "@/components/briefs-card";
import { ClaimsCard } from "@/components/claims-card";
import { DriftCard } from "@/components/drift-card";
import { GooglePanel } from "@/components/google-panel";
import { GraphCard } from "@/components/graph-card";
import { SlackPanel } from "@/components/slack-panel";
import { SourcePanel } from "@/components/source-panel";

const OTHER_SOURCES = [
  { key: "jira", label: "Jira" },
  { key: "microsoft", label: "Microsoft (Outlook + Teams + SharePoint)" },
] as const;

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-10 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">husn.io</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Operational coordination layer. Step 1 — read-only connector dashboard.
          </p>
        </div>
        <nav className="flex items-center gap-2 text-xs">
          <a
            href="/chat"
            className="rounded border px-3 py-1.5"
            style={{
              borderColor: "#6f7bff66",
              color: "#a5b4fc",
              background: "#6f7bff11",
            }}
          >
            Ask the AI TPM →
          </a>
          <a
            href="/connections"
            className="rounded border px-3 py-1.5"
            style={{ borderColor: "var(--border)", color: "var(--text)", background: "#1a1f2c" }}
          >
            Connections →
          </a>
        </nav>
      </header>

      <section className="mb-6">
        <ApiHealth />
      </section>

      <section className="mb-6">
        <GraphCard />
      </section>

      <section className="mb-6">
        <DriftCard />
      </section>

      <section className="mb-6">
        <BriefsCard />
      </section>

      <section className="mb-8">
        <ClaimsCard />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SlackPanel />
        <GooglePanel />
        {OTHER_SOURCES.map((s) => (
          <SourcePanel key={s.key} sourceKey={s.key} label={s.label} />
        ))}
      </section>
    </main>
  );
}
