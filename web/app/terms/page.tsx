import Link from "next/link";

export const metadata = {
  title: "Terms · husn.io",
  description: "Terms of use for the husn.io pilot.",
};

const LAST_UPDATED = "2026-06-05";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:px-6">
      <p className="text-[12px] uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
        Working draft
      </p>
      <h1 className="mt-2 text-[32px] font-semibold tracking-tight">Terms of use</h1>
      <p className="mt-2 text-[14px]" style={{ color: "var(--muted)" }}>
        Last updated {LAST_UPDATED}. Pilot terms while we are in private beta. A
        counsel-reviewed Master Services Agreement and Data Processing
        Agreement replace this page before general availability.
      </p>

      <Section title="The pilot">
        <p>
          husn.io is in a closed pilot. Access is granted by invitation only and
          may be revoked at any time. The service is provided as-is with no
          uptime commitment during the pilot, and is not yet certified or
          audited.
        </p>
      </Section>

      <Section title="What you may use it for">
        <p>
          You may use husn.io to read your own connected tools and your own
          team&apos;s programs. You agree not to use the service to read data
          you are not authorised to read, to circumvent any third-party
          provider&apos;s terms (Atlassian, Slack, Google, Microsoft), or to
          surveil individuals.
        </p>
      </Section>

      <Section title="No individual scoring">
        <p>
          The service does not measure, score, or report on individual
          performance, responsiveness, or activity. You agree not to use any
          output of the service as input to performance review, disciplinary,
          compensation, or termination decisions.
        </p>
      </Section>

      <Section title="Your content stays yours">
        <p>
          You retain all rights in the data you connect. We use it only to
          provide the service to you. We do not train any model on your data,
          we do not sell it, and we do not share it with anyone outside the
          sub-processor list at{" "}
          <Link href="/subprocessors" style={{ color: "var(--accent)" }}>
            /subprocessors
          </Link>
          .
        </p>
      </Section>

      <Section title="Disconnect and erasure">
        <p>
          You can disconnect any source at any time from the in-app connections
          page. To erase past data, email{" "}
          <a href="mailto:privacy@husn.io" style={{ color: "var(--accent)" }}>
            privacy@husn.io
          </a>
          . See the{" "}
          <Link href="/privacy" style={{ color: "var(--accent)" }}>
            privacy page
          </Link>{" "}
          for the procedure and the timeline.
        </p>
      </Section>

      <Section title="Suspension">
        <p>
          We may suspend access if we suspect a violation of these terms, a
          provider&apos;s terms, or any law. We will tell you why if we can.
        </p>
      </Section>

      <Section title="Liability">
        <p>
          During the pilot, the service is provided without warranties. You
          should not rely on it as a system of record. We are not liable for
          decisions made based on what the service surfaces. The intent of the
          product is to reduce the chance of surprises at status meetings, not
          to be authoritative about facts.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          We will email you, and update the last-updated date on this page, if
          we make any material change. Continued use after a change means you
          accept it. If you do not, email us and we will help you off-board.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          For questions about these terms:{" "}
          <a href="mailto:legal@husn.io" style={{ color: "var(--accent)" }}>
            legal@husn.io
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
