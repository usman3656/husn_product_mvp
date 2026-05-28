import { ConnectionsList } from "@/components/connections-list";

export const metadata = {
  title: "Connections · husn.ai",
};

export default function ConnectionsPage() {
  return (
    <main className="mx-auto max-w-4xl px-5 py-8 sm:px-6">
      <header className="mb-8 husn-rise">
        <h1 className="text-[28px] font-semibold tracking-tight">Connections</h1>
        <p className="mt-1 max-w-2xl text-[14px]" style={{ color: "var(--muted)" }}>
          The tools we watch, their status, and when we last synced. Disconnecting stops
          new syncs; your past data is kept.
        </p>
      </header>

      <ConnectionsList />
    </main>
  );
}
