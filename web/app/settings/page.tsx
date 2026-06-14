import Link from "next/link";

import { AccountPanel } from "@/components/account-panel";
import { MembersPanel } from "@/components/members-panel";
import { PasswordPanel } from "@/components/password-panel";

export const metadata = { title: "Settings · Husn" };

export default function SettingsPage() {
  return (
    <main className="mx-auto px-6 lg:px-10 pt-12 pb-24" style={{ maxWidth: "var(--reading-w)" }}>
      <header className="husn-rise">
        <p className="husn-eyebrow">Settings</p>
        <h1 className="husn-display mt-4">Workspace</h1>
        <p className="husn-prose mt-5 max-w-[60ch]">
          Configure how Husn reads, who can ask, and where the briefing lands.
        </p>
      </header>

      <section className="mt-14 space-y-12">
        <Group title="Briefing">
          <Field label="Cadence" value="Every 30 minutes" hint="Husn re-reads your sources and updates the briefing on this cadence." />
          <Field label="Quiet hours" value="22:00 – 07:00" hint="No live updates during these hours. The briefing still rebuilds." />
          <Field label="Personas" value="TPM, Eng Manager, QA Lead, Security Lead, Ops Manager" hint="Who Husn writes for." />
        </Group>

        <Group title="Account">
          <AccountPanel />
          <PasswordPanel />
        </Group>

        <Group title="Members">
          <MembersPanel />
        </Group>

        <Group title="Integrations">
          <Field
            label="Connected tools"
            value="Manage in Connections"
            hint="Add, remove, or reauthorize the sources Husn reads from."
            action={{ label: "Open Connections", href: "/connections" }}
          />
        </Group>

        <Group title="Legal">
          <Field label="Privacy" value="Read policy" action={{ label: "Open", href: "/privacy" }} />
          <Field label="Terms" value="Read terms" action={{ label: "Open", href: "/terms" }} />
          <Field label="Subprocessors" value="See list" action={{ label: "Open", href: "/subprocessors" }} />
        </Group>
      </section>
    </main>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="husn-heading">{title}</h2>
      <div
        className="mt-4 rounded-[var(--radius)] border divide-y"
        style={{ borderColor: "var(--border)", background: "var(--panel)" }}
      >
        {children}
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  hint,
  action,
}: {
  label: string;
  value: string;
  hint?: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-wrap items-start gap-4 px-5 py-4 husn-rule">
      <div className="min-w-[140px]">
        <p className="text-[13px] font-medium" style={{ color: "var(--text)" }}>{label}</p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px]" style={{ color: "var(--text-2)" }}>{value}</p>
        {hint ? <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted)" }}>{hint}</p> : null}
      </div>
      {action ? (
        <Link
          href={action.href}
          className="text-[13px] font-medium"
          style={{ color: "var(--accent)" }}
        >
          {action.label} →
        </Link>
      ) : null}
    </div>
  );
}
