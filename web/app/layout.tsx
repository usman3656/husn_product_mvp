import type { Metadata } from "next";
import "./globals.css";

import { ChatWidget } from "@/components/chat-widget";
import { MobileBar, SideNav } from "@/components/side-nav";
import { THEME_BOOT_SCRIPT } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "Husn for McLean Hospital — clinical coordination intelligence",
  description:
    "Husn reads across the tools McLean's teams already use and surfaces what's drifting, who owns what, and what's at risk — before the meeting. Every claim stays sourced.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* No-FOUC: apply the saved theme before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <SideNav />
        <MobileBar />
        <div className="md:pl-[var(--nav-w)]">
          {children}
        </div>
        <ChatWidget />
      </body>
    </html>
  );
}
