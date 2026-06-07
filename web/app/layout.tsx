import type { Metadata } from "next";
import "./globals.css";

import { MobileBar, SideNav } from "@/components/side-nav";
import { THEME_BOOT_SCRIPT } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "husn — organizational intelligence",
  description:
    "The intelligence layer for your organization. Husn briefs you on what's drifting, what's owned, and what's at risk — before the status meeting.",
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
      </body>
    </html>
  );
}
