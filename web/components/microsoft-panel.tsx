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
    const res = await fetch(`${SERVER_API_URL}/auth/microsoft/status`, {
      cache: "no-store",
    });
    if (!res.ok) return { connections: [] };
    return (await res.json()) as MicrosoftStatus;
  } catch {
    return { connections: [] };
  }
}

export async function MicrosoftPanel() {
  const status = await fetchStatus();
  const isConnected = status.connections.length > 0;

  return (
    <div
      className="rounded-lg border p-5"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">
            Microsoft (Outlook + OneDrive + SharePoint)
          </h2>
          {isConnected && (
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
              {status.connections
                .map((c) => c.upn || c.account_label || `account ${c.id}`)
                .join(", ")}
            </p>
          )}
        </div>
        <div className="flex items-center">
          <span
            className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide"
            style={{
              borderColor: isConnected ? "#22c55e55" : "var(--border)",
              color: isConnected ? "#86efac" : "var(--muted)",
              background: isConnected ? "#22c55e11" : "transparent",
            }}
          >
            {isConnected ? "connected" : "not connected"}
          </span>
          {isConnected && status.connections[0] && (
            <DisconnectButton
              connectionId={status.connections[0].id}
              label={status.connections[0].upn || status.connections[0].account_label || "Microsoft"}
            />
          )}
        </div>
      </div>

      {!isConnected ? (
        <NotConnected />
      ) : (
        <>
          <MicrosoftFeed />
          <details className="mt-4">
            <summary
              className="cursor-pointer text-[11px] underline"
              style={{ color: "var(--muted)" }}
            >
              Edit allowlist (Outlook folders + OneDrive folders)
            </summary>
            <MicrosoftAllowlist />
          </details>
        </>
      )}
    </div>
  );
}

function NotConnected() {
  return (
    <div
      className="mt-4 flex items-center justify-between rounded border border-dashed p-4"
      style={{ borderColor: "var(--border)" }}
    >
      <div>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Authorize a Microsoft account to start ingesting.
        </p>
        <p className="mt-1 text-[10px]" style={{ color: "var(--muted)" }}>
          Scopes: <code className="font-mono">Mail.Read</code>,{" "}
          <code className="font-mono">Files.Read</code>,{" "}
          <code className="font-mono">Sites.Read.All</code>. Nothing is read
          until you pick an allowlist.
        </p>
      </div>
      <a
        href={`${BROWSER_API_URL}/auth/microsoft/start`}
        className="ml-4 shrink-0 rounded border px-3 py-1.5 text-xs font-medium"
        style={{
          borderColor: "var(--border)",
          color: "var(--text)",
          background: "#1a1f2c",
        }}
      >
        Connect Microsoft →
      </a>
    </div>
  );
}
