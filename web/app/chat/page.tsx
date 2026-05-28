import Link from "next/link";

import { ChatRoom } from "@/components/chat-room";

export const metadata = {
  title: "Chat — husn.io",
};

export default function ChatPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <Link className="text-xs" style={{ color: "var(--muted)" }} href="/">
            ← Back to dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Ask Husn</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Free-form Q&amp;A grounded in your operational graph. Every answer cites
            claim ids / artifact ids that you can click through to the source.
          </p>
        </div>
      </header>
      <ChatRoom />
    </main>
  );
}
