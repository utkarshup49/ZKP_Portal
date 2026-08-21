import type { Metadata } from "next";

import { Nav } from "@/components/Nav";

import "./globals.css";

export const metadata: Metadata = {
  title: "ZK Credential Verification",
  description:
    "Zero-knowledge academic credential verification: university, student and employer portals.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
