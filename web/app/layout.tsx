import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PreflightX — pre-execution verification for autonomous DeFi agents on X Layer",
  description:
    "One call composes 8 OnchainOS endpoints + Uniswap AI + X Layer RPC. Signed VerifiedPlan or structured fail. PreflightGuard enforces the promise on-chain.",
  openGraph: {
    title: "PreflightX",
    description:
      "Pre-execution verification for autonomous DeFi agents on X Layer. Signed, enforced, honest.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
