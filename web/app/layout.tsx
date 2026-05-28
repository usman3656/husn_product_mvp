import type { Metadata } from "next";
import "./globals.css";

import { TopBar } from "@/components/top-bar";
import { UpcomingIssues } from "@/components/upcoming-issues";

export const metadata: Metadata = {
  title: "husn.ai",
  description: "The alignment layer for program teams.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <TopBar />
        {children}
        <UpcomingIssues />
      </body>
    </html>
  );
}
