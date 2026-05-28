import { FETCH_INIT } from "@/lib/fetch-init";
// Server-side fetch (this is a server component): use API_URL which points to
// the api service inside the docker network. Browser-facing copy still uses
// NEXT_PUBLIC_API_URL so the visible string matches where the user can curl.
const SERVER_API_URL = process.env.API_URL ?? "http://api:8000";
const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Health = { status: string; version?: string };

async function fetchHealth(): Promise<Health | null> {
  try {
    const res = await fetch(`${SERVER_API_URL}/health`, FETCH_INIT);
    if (!res.ok) return null;
    return (await res.json()) as Health;
  } catch {
    return null;
  }
}

export async function ApiHealth() {
  const health = await fetchHealth();
  const ok = health?.status === "ok";

  return (
    <div
      className="flex items-center justify-between rounded-lg border px-4 py-3"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div>
        <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          API
        </p>
        <p className="font-mono text-sm">{BROWSER_API_URL}</p>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: ok ? "#3ecf8e" : "#ef4444" }}
        />
        <span className="text-sm">
          {ok ? `ok (v${health?.version ?? "?"})` : "unreachable"}
        </span>
      </div>
    </div>
  );
}
