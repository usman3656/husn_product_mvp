import Link from "next/link";

export const metadata = {
  title: "Privacy · husn.io",
  description:
    "How husn.io handles the data we read from your connected tools.",
};

const LAST_UPDATED = "2026-06-05";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:px-6">
      <p className="text-[12px] uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
        Working draft
      </p>
      <h1 className="mt-2 text-[32px] font-semibold tracking-tight">Privacy</h1>
      <p className="mt-2 text-[14px]" style={{ color: "var(--muted)" }}>
        Last updated {LAST_UPDATED}. This page is a working draft and will be
        replaced by a counsel-reviewed policy before general availability.
      </p>

      <Section title="Who we are">
        <p>
          husn.io is operated by the founder, contactable at{" "}
          <a href="mailto:privacy@husn.io" style={{ color: "var(--accent)" }}>
            privacy@husn.io
          </a>
          . We are a single-tenant pilot today; multi-tenant production with a
          formal data processing agreement is in progress.
        </p>
      </Section>

      <Section title="What we read">
        <p>
          When you connect a tool (Jira, Slack, Google Workspace, or Microsoft
          365), we read only the items inside the labels, channels, projects,
          or folders you allowlist. We do not crawl your full account. Examples
          of what we read:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Jira issues, comments, and status transitions</li>
          <li>Slack messages and threads inside allowlisted channels</li>
          <li>Gmail messages with allowlisted labels</li>
          <li>Google Drive and OneDrive documents inside allowlisted folders</li>
        </ul>
      </Section>

      <Section title="Why we read it">
        <p>
          To detect when facts about your program (launch dates, owners,
          decisions) drift across tools, and to write per-persona pre-meeting
          briefs that cite the exact message, ticket, or document each
          statement came from.
        </p>
      </Section>

      <Section title="Where it lives">
        <p>
          Hetzner Online GmbH (Falkenstein, Germany) for the application and
          its Postgres database. OAuth tokens are stored encrypted at rest.
          Network traffic is HTTPS only, with TLS issued by Let&apos;s Encrypt.
          We do not sell, rent, or share your data.
        </p>
      </Section>

      <Section title="Sub-processors">
        <p>
          We use a small set of sub-processors to run the service. The current
          list is at{" "}
          <Link href="/subprocessors" style={{ color: "var(--accent)" }}>
            /subprocessors
          </Link>
          . We will give 30 days notice before adding a new sub-processor.
        </p>
      </Section>

      <Section title="Retention and deletion">
        <p>
          When you disconnect a tool, we stop syncing immediately. Past data is
          kept until you ask us to erase it. To request erasure under GDPR
          Article 17 or for any reason, email{" "}
          <a href="mailto:privacy@husn.io" style={{ color: "var(--accent)" }}>
            privacy@husn.io
          </a>
          . We will action the request within 30 days and confirm completion
          in writing.
        </p>
      </Section>

      <Section title="What we do not do">
        <p>
          We do not surface, score, or report on individual responsiveness. We
          do not provide output that may be used as input to performance,
          disciplinary, or termination decisions. We do not train any model on
          your data. The classification of work in the EU AI Act sense
          deliberately avoids Annex III high-risk categories by these
          structural choices.
        </p>
      </Section>

      <Section title="Cookies and analytics">
        <p>
          Session cookies are used to keep you signed in. We do not run
          third-party analytics, ad pixels, or tracking scripts.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          For privacy questions, data requests, or to nominate a different
          contact for your account:{" "}
          <a href="mailto:privacy@husn.io" style={{ color: "var(--accent)" }}>
            privacy@husn.io
          </a>
          .
        </p>
      </Section>

      <p className="mt-12 text-[12px]" style={{ color: "var(--muted)" }}>
        <Link href="/" style={{ color: "var(--accent)" }}>← Back to app</Link>
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[18px] font-semibold tracking-tight">{title}</h2>
      <div className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--text-2, var(--text))" }}>
        {children}
      </div>
    </section>
  );
}
