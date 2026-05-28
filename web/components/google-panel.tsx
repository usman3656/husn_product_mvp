import { FETCH_INIT } from "@/lib/fetch-init";
import { DEMO_MODE } from "@/lib/demo";
import { DisconnectButton } from "@/components/disconnect-button";
import { GoogleAllowlist } from "@/components/google-allowlist";
import { GoogleFeed } from "@/components/google-feed";

const SERVER_API_URL = process.env.API_URL ?? "http://api:8000";
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
    const res = await fetch(`${SERVER_API_URL}/auth/google/status`, FETCH_INIT);
    if (!res.ok) return { connections: [] };
    return (await res.json()) as GoogleStatus;
  } catch {
    return { connections: [] };
  }
}

export async function GooglePanel() {
  const status = await fetchStatus();
  const isConnected = status.connections.length > 0;

  return (
    <div
      className="rounded-lg border p-5"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Google (Gmail + Drive)</h2>
          {isConnected && (
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
              {status.connections
                .map((c) => c.email || c.account_label || `account ${c.id}`)
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
              label={status.connections[0].email || status.connections[0].account_label || "Google"}
            />
          )}
        </div>
      </div>

      {!isConnected ? (
        <NotConnected />
      ) : (
        <>
          <GoogleFeed />
          {!DEMO_MODE && (
            <details className="mt-4">
              <summary
                className="cursor-pointer text-[11px] underline"
                style={{ color: "var(--muted)" }}
              >
                Edit allowlist (labels + folders)
              </summary>
              <GoogleAllowlist />
            </details>
          )}
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
          Authorize a Google account to start ingesting.
        </p>
        <p className="mt-1 text-[10px]" style={{ color: "var(--muted)" }}>
          Scopes: <code className="font-mono">gmail.readonly</code>,{" "}
          <code className="font-mono">drive.readonly</code>. Nothing is read until you
          pick a label / folder allowlist.
        </p>
      </div>
      <a
        href={`${BROWSER_API_URL}/auth/google/start`}
        className="ml-4 shrink-0 rounded border px-3 py-1.5 text-xs font-medium"
        style={{ borderColor: "var(--border)", color: "var(--text)", background: "#1a1f2c" }}
      >
        Connect Google →
      </a>
    </div>
  );
}

