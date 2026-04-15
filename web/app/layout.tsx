import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PreflightX — pre-execution verification for autonomous DeFi agents on X Layer",
  description:
    "One call composes 8 OnchainOS endpoints + Uniswap AI + X Layer RPC. Signed VerifiedPlan or structured fail. PreflightGuard enforces the promise on-chain.",
  openGraph: {
    title: "PreflightX — preflight before you trade. Enforce it on-chain.",
    description:
      "Pre-execution verification for autonomous DeFi agents on X Layer. Signed, enforced, honest.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PreflightX",
    description:
      "Pre-execution verification for autonomous DeFi agents on X Layer.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen antialiased relative">
        <div className="ambient-bg" aria-hidden />
        <div className="noise-layer" aria-hidden />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
