import { CardHeader, EmptyState, Pill, Tile } from "@/components/ui";
import { serverFetch } from "@/lib/api";
import { DisconnectButton } from "@/components/disconnect-button";
import { GoogleAllowlist } from "@/components/google-allowlist";
import { GoogleFeed } from "@/components/google-feed";

const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type GoogleConnection = {
  id: number;
  account_id: string;
  account_label: string | null;
  email: string | null;
  name: string | null;
  scopes: string | null;
  token_expires_at: string | null;
};

type GoogleStatus = { connections: GoogleConnection[] };

async function fetchStatus(): Promise<GoogleStatus> {
  try {
    const res = await serverFetch("/auth/google/status");
    if (!res.ok) return { connections: [] };
    return (await res.json()) as GoogleStatus;
  } catch {
    return { connections: [] };
  }
}

export async function GooglePanel() {
  const status = await fetchStatus();
  const isConnected = status.connections.length > 0;
  const sub = isConnected
    ? status.connections.map((c) => c.email || c.account_label || `account ${c.id}`).join(", ")
    : "Gmail and Drive";

  return (
    <Tile lift>
      <CardHeader
        title="Google"
        subtitle={sub}
        right={
          <div className="flex items-center">
            <Pill tone={isConnected ? "success" : "neutral"}>
              {isConnected ? "Connected" : "Not connected"}
            </Pill>
            {isConnected && status.connections[0] && (
              <DisconnectButton
                connectionId={status.connections[0].id}
                label={status.connections[0].email || status.connections[0].account_label || "Google"}
              />
            )}
          </div>
        }
      />

      {!isConnected ? (
        <div className="mt-4">
          <EmptyState
            title="Connect Google to start"
            hint="We only read what you allow. Nothing is pulled until you pick the labels and folders to watch."
          >
            <a
              href={`${BROWSER_API_URL}/auth/google/start`}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium"
              style={{ background: "var(--accent)", color: "var(--on-accent)" }}
            >
              Connect Google
              <span aria-hidden>→</span>
            </a>
          </EmptyState>
        </div>
      ) : (
        <>
          <GoogleFeed />
          <details className="mt-4">
            <summary className="cursor-pointer text-[12px]" style={{ color: "var(--accent-ink)" }}>
              Edit what we watch (labels and folders)
            </summary>
            <GoogleAllowlist />
          </details>
        </>
      )}
    </Tile>
  );
}
