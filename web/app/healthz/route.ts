// Lightweight liveness probe for container healthchecks and uptime monitors.
// Returns 200 immediately without touching the API or DB, so docker
// healthchecks don't depend on the slower full dashboard render.

export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
