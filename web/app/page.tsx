import { ApiHealth } from "@/components/api-health";
import { BriefsCard } from "@/components/briefs-card";
import { ClaimsCard } from "@/components/claims-card";
import { DriftCard } from "@/components/drift-card";
import { GooglePanel } from "@/components/google-panel";
import { GraphCard } from "@/components/graph-card";
import { MicrosoftPanel } from "@/components/microsoft-panel";
import { SlackPanel } from "@/components/slack-panel";
import { SourcePanel } from "@/components/source-panel";

const OTHER_SOURCES = [{ key: "jira", label: "Jira" }] as const;

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-8 sm:px-6">
      <section className="mb-8 husn-rise">
        <h1 className="text-[28px] font-semibold tracking-tight">Project Atlas</h1>
        <p className="mt-1 max-w-2xl text-[14px]" style={{ color: "var(--muted)" }}>
          The alignment layer for your program. Status meetings should not be where
          you discover problems, so here is what is drifting across your tools right now.
        </p>
      </section>

      <div className="[column-fill:_balance] gap-5 sm:columns-2 lg:columns-3 [&>*]:mb-5 [&>*]:break-inside-avoid husn-rise">
        <DriftCard />
        <GraphCard />
        <BriefsCard />
        <SlackPanel />
        <ClaimsCard />
        <GooglePanel />
        <MicrosoftPanel />
        {OTHER_SOURCES.map((s) => (
          <SourcePanel key={s.key} sourceKey={s.key} label={s.label} />
        ))}
        <ApiHealth />
      </div>
    </main>
  );
}
