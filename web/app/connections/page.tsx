import Link from "next/link";

import { ConnectionsList } from "@/components/connections-list";

export const metadata = {
  title: "Connections — husn.io",
};

export default function ConnectionsPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <Link
          href="/"
          className="text-xs"
          style={{ color: "var(--muted)" }}
        >
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Authorized source connections, token health, last sync, and counts.
          Disconnecting stops syncing — historical data is kept.
        </p>
      </header>

      <ConnectionsList />
    </main>
  );
}
