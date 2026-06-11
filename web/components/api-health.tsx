import { Dot, Tile } from "@/components/ui";
import { serverJson } from "@/lib/api";
// Server-side fetch (this is a server component): serverJson uses API_URL which
// points to the api service inside the docker network. Browser-facing copy still
// uses NEXT_PUBLIC_API_URL so the visible string matches where the user can curl.
const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Health = { status: string; version?: string };

async function fetchHealth(): Promise<Health | null> {
  return serverJson<Health>("/health");
}

export async function ApiHealth() {
  const health = await fetchHealth();
  const ok = health?.status === "ok";

  return (
    <Tile lift className="flex items-center justify-between">
      <div className="min-w-0">
        <p className="text-[12px] font-medium" style={{ color: "var(--muted)" }}>
          Service
        </p>
        <p className="truncate font-mono text-[13px]">{BROWSER_API_URL}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Dot tone={ok ? "success" : "danger"} />
        <span className="text-[13px] font-medium">
          {ok ? `Online (v${health?.version ?? "?"})` : "Unreachable"}
        </span>
      </div>
    </Tile>
  );
}
