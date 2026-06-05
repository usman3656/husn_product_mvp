import Link from "next/link";

export const metadata = {
  title: "Sub-processors · husn.io",
  description: "Third-party services husn.io uses to operate.",
};

const LAST_UPDATED = "2026-06-05";

type Sub = {
  name: string;
  purpose: string;
  region: string;
  url: string;
};

const SUBS: Sub[] = [
  {
    name: "Hetzner Online GmbH",
    purpose: "Application hosting, Postgres database, Redis queue.",
    region: "Falkenstein, Germany (EU).",
    url: "https://www.hetzner.com",
  },
  {
    name: "Cloudflare, Inc.",
    purpose: "Authoritative DNS for app.husn.io and api.husn.io.",
    region: "Global anycast.",
    url: "https://www.cloudflare.com",
  },
  {
    name: "Let's Encrypt (ISRG)",
    purpose: "Issuing the TLS certificates that secure traffic in transit.",
    region: "United States.",
    url: "https://letsencrypt.org",
  },
  {
    name: "Atlassian, Inc.",
    purpose: "OAuth provider when you connect Jira.",
    region: "United States.",
    url: "https://www.atlassian.com",
  },
  {
    name: "Slack Technologies, LLC (Salesforce)",
    purpose: "OAuth provider when you connect Slack.",
    region: "United States.",
    url: "https://slack.com",
  },
  {
    name: "Google LLC",
    purpose:
      "OAuth provider when you connect Gmail or Drive. Workspace API access is read-only and limited to the labels and folders you allowlist.",
    region: "United States.",
    url: "https://workspace.google.com",
  },
  {
    name: "Microsoft Corporation",
    purpose:
      "OAuth provider when you connect Outlook or OneDrive (Microsoft Graph).",
    region: "United States.",
    url: "https://www.microsoft.com",
  },
  {
    name: "Groq, Inc.",
    purpose:
      "LLM inference for the brief renderer. Inputs and outputs are processed under Groq's enterprise policy; we do not allow training on customer data.",
    region: "United States.",
    url: "https://groq.com",
  },
  {
    name: "GitHub, Inc.",
    purpose: "Source code and container registry.",
    region: "United States.",
    url: "https://github.com",
  },
];

export default function SubprocessorsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:px-6">
      <p className="text-[12px] uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
        Working list
      </p>
      <h1 className="mt-2 text-[32px] font-semibold tracking-tight">Sub-processors</h1>
      <p className="mt-2 max-w-2xl text-[14px]" style={{ color: "var(--muted)" }}>
        Last updated {LAST_UPDATED}. These are the third-party services we rely
        on to run husn.io. We will give 30 days notice before adding a new one.
        See the{" "}
        <Link href="/privacy" style={{ color: "var(--accent)" }}>
          privacy page
        </Link>{" "}
        for how to ask questions or object.
      </p>

      <ul className="mt-8 space-y-5">
        {SUBS.map((s) => (
          <li
            key={s.name}
            className="rounded-[var(--radius)] border p-5"
            style={{
              borderColor: "var(--border)",
              background: "var(--panel)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-[16px] font-semibold">{s.name}</h2>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-[12px]"
                style={{ color: "var(--muted)" }}
              >
                {new URL(s.url).hostname}
              </a>
            </div>
            <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--text-2, var(--text))" }}>
              {s.purpose}
            </p>
            <p className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>
              {s.region}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-12 text-[12px]" style={{ color: "var(--muted)" }}>
        <Link href="/" style={{ color: "var(--accent)" }}>← Back to app</Link>
      </p>
    </main>
  );
}
