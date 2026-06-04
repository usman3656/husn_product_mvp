import { CardHeader, EmptyState, Pill, Tile } from "@/components/ui";
import { FETCH_INIT } from "@/lib/fetch-init";
import { DisconnectButton } from "@/components/disconnect-button";
import { MicrosoftAllowlist } from "@/components/microsoft-allowlist";
import { MicrosoftFeed } from "@/components/microsoft-feed";

const SERVER_API_URL = process.env.API_URL ?? "http://api:8000";
const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type MicrosoftConnection = {
  id: number;
  account_id: string;
  account_label: string | null;
  upn: string | null;
  display_name: string | null;
  scopes: string | null;
  token_expires_at: string | null;
};

type MicrosoftStatus = { connections: MicrosoftConnection[] };

async function fetchStatus(): Promise<MicrosoftStatus> {
  try {
    const res = await fetch(`${SERVER_API_URL}/auth/microsoft/status`, FETCH_INIT);
    if (!res.ok) return { connections: [] };
    return (await res.json()) as MicrosoftStatus;
  } catch {
    return { connections: [] };
  }
}

export async function MicrosoftPanel() {
  const status = await fetchStatus();
  const isConnected = status.connections.length > 0;
  const sub = isConnected
    ? status.connections.map((c) => c.upn || c.account_label || `account ${c.id}`).join(", ")
    : "Outlook, OneDrive, and SharePoint";

  return (
    <Tile lift>
      <CardHeader
        title="Microsoft"
        subtitle={sub}
        right={
          <div className="flex items-center">
            <Pill tone={isConnected ? "success" : "neutral"}>
              {isConnected ? "Connected" : "Not connected"}
            </Pill>
            {isConnected && status.connections[0] && (
              <DisconnectButton
                connectionId={status.connections[0].id}
                label={status.connections[0].upn || status.connections[0].account_label || "Microsoft"}
              />
            )}
          </div>
        }
      />

      {!isConnected ? (
        <div className="mt-4">
          <EmptyState
            title="Connect Microsoft to start"
            hint="We only read what you allow. Nothing is pulled until you pick the folders to watch."
          >
            <a
              href={`${BROWSER_API_URL}/auth/microsoft/start`}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium"
              style={{ background: "var(--accent)", color: "var(--on-accent)" }}
            >
              Connect Microsoft
              <span aria-hidden>→</span>
            </a>
          </EmptyState>
        </div>
      ) : (
        <>
          <MicrosoftFeed />
          <details className="mt-4">
            <summary className="cursor-pointer text-[12px]" style={{ color: "var(--accent-ink)" }}>
              Edit what we watch (Outlook and OneDrive folders)
            </summary>
            <MicrosoftAllowlist />
          </details>
        </>
      )}
    </Tile>
  );
}
