import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PolicyForge — SOC 2 & ISO 27001 policy packs for startups",
  description:
    "Generate a complete, auditor-grade compliance policy pack mapped to your real stack in minutes. Starter pack $199 one-time.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col`}
      >
        <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-50">
          <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
            <Link href="/" className="font-semibold text-lg tracking-tight">
              PolicyForge
            </Link>
            <nav className="flex items-center gap-6 text-sm font-medium text-muted-foreground">
              <Link href="/" className="hover:text-foreground transition-colors">
                Home
              </Link>
              <Link href="/pricing" className="hover:text-foreground transition-colors">
                Pricing
              </Link>
              <Link href="/intake" className="hover:text-foreground transition-colors">
                Start Intake
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <Analytics />
        <SpeedInsights />
        <footer className="border-t border-border bg-muted/40">
          <div className="max-w-5xl mx-auto px-6 py-8">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
              <p>© {new Date().getFullYear()} PolicyForge. All rights reserved.</p>
              <div className="flex items-center gap-6">
                <Link href="/terms" className="hover:text-foreground transition-colors">
                  Terms
                </Link>
                <Link href="/privacy" className="hover:text-foreground transition-colors">
                  Privacy
                </Link>
                <Link href="/disclaimer" className="hover:text-foreground transition-colors">
                  Disclaimer
                </Link>
              </div>
            </div>
            <p className="mt-4 text-xs text-muted-foreground text-center">
              PolicyForge is a document-generation tool, not a law firm or compliance consultancy.
              Generated policies are a starting point and should be reviewed by your auditor,
              compliance consultant, or legal counsel before submission. We do not certify compliance.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
