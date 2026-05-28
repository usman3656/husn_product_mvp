import Link from "next/link";

import { ApiHealth } from "@/components/api-health";
import { BriefsCard } from "@/components/briefs-card";
import { ClaimsCard } from "@/components/claims-card";
import { DriftCard } from "@/components/drift-card";
import { GooglePanel } from "@/components/google-panel";
import { GraphCard } from "@/components/graph-card";
import { MicrosoftPanel } from "@/components/microsoft-panel";
import { SlackPanel } from "@/components/slack-panel";
import { SourcePanel } from "@/components/source-panel";
import {
  CardHeader,
  ConflictPair,
  EvidenceChip,
  PersonaBrief,
  Pill,
  Stat,
  Tile,
} from "@/components/ui";
import { DEMO_MODE } from "@/lib/demo";

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

      {DEMO_MODE ? <DemoBoard /> : <LiveBoard />}
    </main>
  );
}

/* ------------------------------------------------------------------------- */
/* DEMO: a curated, varied board telling the Project Atlas story.            */
/* ------------------------------------------------------------------------- */

function DemoBoard() {
  return (
    <div className="husn-rise [column-fill:_balance] gap-5 sm:columns-2 lg:columns-3 [&>*]:mb-5 [&>*]:break-inside-avoid">
      {/* Most important signal: the launch-date conflict, top-left, largest. */}
      <Tile tone="danger" lift>
        <CardHeader
          title="Your launch date disagrees across tools"
          subtitle="Two sources, two dates. Nobody has reconciled them."
          right={<Pill tone="danger">Conflict</Pill>}
        />
        <div className="mt-4">
          <ConflictPair
            a={{
              source: "Jira",
              cite: "ATLAS-204",
              value: "June 10",
              detail: "Epic target, confirmed by the eng lead in Slack on May 18.",
            }}
            b={{
              source: "Google Drive",
              cite: "Atlas Launch Plan v3",
              value: "June 3",
              detail: "Steerco deck, not updated since the date moved. Finance still plans to this.",
            }}
          />
        </div>
        <p className="mt-3 text-[12px] leading-relaxed" style={{ color: "var(--muted)" }}>
          The operative date is June 10. The deck is stale. We are tracking this until
          the deck is corrected.
        </p>
      </Tile>

      {/* Big-numeral stat tile */}
      <Tile lift>
        <Stat
          value="2,434"
          caption="Facts kept in sync"
          tone="success"
          hint="Across Jira, Slack, Google, and Microsoft this week."
        />
      </Tile>

      {/* Accent promo: Ask Husn */}
      <Tile tone="dark" lift>
        <p className="text-[12px] font-medium" style={{ color: "var(--dark-muted)" }}>
          Ask Husn
        </p>
        <p className="mt-2 text-[18px] font-semibold leading-snug">
          Ask anything about your program and get an answer with the receipts.
        </p>
        <Link
          href="/chat"
          className="mt-4 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium"
          style={{ background: "var(--accent)", color: "var(--on-accent)" }}
        >
          Start a question
          <span aria-hidden>→</span>
        </Link>
      </Tile>

      {/* Zero made-up facts */}
      <Tile tone="success" lift>
        <Stat
          value="0"
          caption="Made-up facts"
          tone="success"
          hint="Every answer cites the source it came from. No guessing."
        />
      </Tile>

      {/* Security RISK tile */}
      <Tile tone="warning" lift>
        <CardHeader
          title="Security sign-off is not actually done"
          right={<Pill tone="warning">Risk</Pill>}
        />
        <p className="mt-3 text-[13px] leading-relaxed" style={{ color: "var(--text-2)" }}>
          The launch checklist says security review is approved, but the review thread
          shows the reviewer asked for a re-scan after the May 15 auth change and never
          signed off.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <EvidenceChip source="Confluence" cite="Launch checklist" tone="warning" />
          <EvidenceChip source="Slack" cite="#security-review" tone="warning" />
        </div>
      </Tile>

      {/* QA persona brief */}
      <Tile lift>
        <CardHeader title="Before your next standup" subtitle="A quick read for QA." />
        <div className="mt-4">
          <PersonaBrief
            persona="QA"
            headline="Regression timing is tight"
            meta="updated 2h ago"
            defaultOpen
          >
            <ul className="space-y-2 text-[12.5px] leading-relaxed">
              <li className="flex gap-2">
                <span aria-hidden style={{ color: "var(--muted)" }}>•</span>
                <span>
                  The regression suite is scheduled to finish June 8, leaving 2 days
                  before launch. <EvidenceChip source="Jira" cite="ATLAS-251" />
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden style={{ color: "var(--muted)" }}>•</span>
                <span>
                  No buffer for re-test if a P1 lands. Worth raising the date risk now.{" "}
                  <EvidenceChip source="Slack" cite="#atlas-qa" />
                </span>
              </li>
            </ul>
          </PersonaBrief>
        </div>
      </Tile>

      {/* Value prop tile */}
      <Tile tone="accent" lift>
        <p className="text-[12px] font-medium" style={{ color: "var(--accent-ink)" }}>
          Why husn
        </p>
        <p className="mt-2 text-[16px] font-medium leading-snug">
          We watch Jira, Slack, Google, and Microsoft, and tell you the moment a fact
          drifts apart, before the meeting does.
        </p>
      </Tile>

      {/* Source tiles, quiet, with counts */}
      <SourceTile name="Jira" count={214} hint="Issues and epics" />
      <SourceTile name="Slack" count={1380} hint="Messages and threads" />
      <SourceTile name="Google" count={642} hint="Gmail and Drive" />
      <SourceTile name="Microsoft" count={198} hint="Outlook and OneDrive" />

      {/* Calm closing stat */}
      <Tile lift>
        <Stat value="4" caption="Tools watched continuously" hint="Synced every few minutes." />
      </Tile>
    </div>
  );
}

function SourceTile({ name, count, hint }: { name: string; count: number; hint: string }) {
  return (
    <Tile lift>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[14px] font-semibold">{name}</p>
          <p className="mt-0.5 text-[12px]" style={{ color: "var(--muted)" }}>
            {hint}
          </p>
        </div>
        <Pill tone="success">In sync</Pill>
      </div>
      <p className="mt-3 text-[28px] font-semibold" style={{ letterSpacing: "-0.02em" }}>
        {count.toLocaleString()}
        <span className="ml-1.5 text-[12px] font-normal" style={{ color: "var(--muted)" }}>
          items
        </span>
      </p>
    </Tile>
  );
}

/* ------------------------------------------------------------------------- */
/* LIVE: real server-component cards, inside the same masonry, restyled.     */
/* ------------------------------------------------------------------------- */

function LiveBoard() {
  return (
    <div className="[column-fill:_balance] gap-5 sm:columns-2 lg:columns-3 [&>*]:mb-5 [&>*]:break-inside-avoid">
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
  );
}
