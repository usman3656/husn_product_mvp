import { ConnectionsList } from "@/components/connections-list";
import { SyncNowButton } from "@/components/sync-now-button";
import { serverJson, type Me } from "@/lib/api";

export const metadata = {
  title: "Connections · Husn",
};

export default async function ConnectionsPage() {
  const me = await serverJson<Me>("/auth/me");
  const role = me?.workspace?.role;
  const isAdmin = role === "owner" || role === "admin";

  return (
    <main className="mx-auto px-6 lg:px-10 pt-12 pb-24" style={{ maxWidth: "var(--reading-w)" }}>
      <header className="husn-rise">
        <p className="husn-eyebrow">Workspace · Plumbing</p>
        <h1 className="husn-title mt-4">Connections</h1>
        <p className="husn-prose mt-4 max-w-[60ch]">
          The tools Husn reads from. This is the plumbing — the interesting work
          happens on the briefing. Disconnecting stops new syncs; past data is kept.
        </p>
        <SyncNowButton isAdmin={isAdmin} />
      </header>
      <div className="mt-10">
        <ConnectionsList />
      </div>
    </main>
  );
}
