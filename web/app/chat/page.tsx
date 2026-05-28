import { ChatRoom } from "@/components/chat-room";

export const metadata = {
  title: "Ask Husn · husn.ai",
};

export default function ChatPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-8 sm:px-6">
      <header className="mb-6 husn-rise">
        <h1 className="text-[28px] font-semibold tracking-tight">Ask Husn</h1>
        <p className="mt-1 max-w-2xl text-[14px]" style={{ color: "var(--muted)" }}>
          Ask anything about your program. Every answer points back to the message,
          ticket, or doc it came from, so you can check the source.
        </p>
      </header>
      <ChatRoom />
    </main>
  );
}
