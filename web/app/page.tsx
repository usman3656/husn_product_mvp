import { ApiHealth } from "@/components/api-health";
import { SourcePanel } from "@/components/source-panel";

const SOURCES = [
  { key: "slack", label: "Slack" },
  { key: "jira", label: "Jira" },
  { key: "google", label: "Google (Gmail + Drive)" },
  { key: "microsoft", label: "Microsoft (Outlook + Teams + SharePoint)" },
] as const;

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight">husn.io</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Operational coordination layer. Step 1 — read-only connector dashboard.
        </p>
      </header>

      <section className="mb-10">
        <ApiHealth />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {SOURCES.map((s) => (
          <SourcePanel key={s.key} sourceKey={s.key} label={s.label} />
        ))}
      </section>
    </main>
  );
}
