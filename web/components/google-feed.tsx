import { FETCH_INIT } from "@/lib/fetch-init";
const SERVER_API_URL = process.env.API_URL ?? "http://api:8000";

type Artifact = {
  id: number;
  source: string;
  kind: string;
  external_id: string;
  fetched_at: string;
  summary: Record<string, unknown>;
};

async function fetchKind(kind: string, limit = 10): Promise<Artifact[]> {
  try {
    const r = await fetch(
      `${SERVER_API_URL}/api/artifacts?source=google&kind=${kind}&limit=${limit}`,
      FETCH_INIT,
    );
    if (!r.ok) return [];
    const body = (await r.json()) as { items: Artifact[] };
    return body.items;
  } catch {
    return [];
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export async function GoogleFeed() {
  const [emails, docs, sheets] = await Promise.all([
    fetchKind("email", 10),
    fetchKind("doc", 10),
    fetchKind("sheet", 10),
  ]);

  if (emails.length === 0 && docs.length === 0 && sheets.length === 0) {
    return (
      <div
        className="mt-4 rounded border border-dashed p-4 text-xs"
        style={{ borderColor: "var(--border)", color: "var(--muted)" }}
      >
        Allowlist saved but no items ingested yet — backfill runs every minute at :15.
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      <Section
        icon="📧"
        label={`Emails (${emails.length})`}
        items={emails}
        defaultOpen
        renderItem={(a) => (
          <EmailRow
            key={a.id}
            subject={a.summary.subject as string | null}
            from={a.summary.from as string | null}
            snippet={a.summary.snippet as string | null}
          />
        )}
      />
      <Section
        icon="📄"
        label={`Docs (${docs.length})`}
        items={docs}
        renderItem={(a) => (
          <DocRow
            key={a.id}
            name={a.summary.name as string | null}
            modified={a.summary.modified as string | null}
            owner={a.summary.owner as string | null}
          />
        )}
      />
      <Section
        icon="📊"
        label={`Sheets (${sheets.length})`}
        items={sheets}
        renderItem={(a) => (
          <SheetRow
            key={a.id}
            name={a.summary.name as string | null}
            sheetCount={a.summary.sheets as number | null}
            modified={a.summary.modified as string | null}
          />
        )}
      />
    </div>
  );
}

function Section({
  icon,
  label,
  items,
  renderItem,
  defaultOpen,
}: {
  icon: string;
  label: string;
  items: Artifact[];
  renderItem: (a: Artifact) => React.ReactNode;
  defaultOpen?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <details
      open={defaultOpen}
      className="rounded border"
      style={{ borderColor: "var(--border)", background: "#0f1218" }}
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs"
        style={{ color: "var(--text)" }}
      >
        <span className="flex items-center gap-2">
          <span style={{ color: "var(--muted)" }}>▸</span>
          <span>{icon}</span>
          <span>{label}</span>
        </span>
      </summary>
      <ul className="border-t px-3 py-2 space-y-1" style={{ borderColor: "var(--border)" }}>
        {items.map(renderItem)}
      </ul>
    </details>
  );
}

function EmailRow({
  subject,
  from,
  snippet,
}: {
  subject: string | null;
  from: string | null;
  snippet: string | null;
}) {
  return (
    <li className="text-[11px] leading-relaxed">
      <p className="font-medium truncate">{subject || "(no subject)"}</p>
      <p style={{ color: "var(--muted)" }} className="truncate">
        {from} {snippet ? <>· {snippet}</> : null}
      </p>
    </li>
  );
}

function DocRow({
  name,
  modified,
  owner,
}: {
  name: string | null;
  modified: string | null;
  owner: string | null;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-[11px]">
      <span className="flex-1 truncate">{name}</span>
      <span style={{ color: "var(--muted)" }} className="shrink-0">
        {owner} · {timeAgo(modified)}
      </span>
    </li>
  );
}

function SheetRow({
  name,
  sheetCount,
  modified,
}: {
  name: string | null;
  sheetCount: number | null;
  modified: string | null;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-[11px]">
      <span className="flex-1 truncate">{name}</span>
      <span style={{ color: "var(--muted)" }} className="shrink-0">
        {sheetCount ?? "?"} tabs · {timeAgo(modified)}
      </span>
    </li>
  );
}
