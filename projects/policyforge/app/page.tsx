"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import {
  Shield,
  FileText,
  Map,
  Clock,
  Users,
  Zap,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus("success");
        setMessage("You're on the list. We'll be in touch before launch.");
        setEmail("");
      } else {
        setStatus("error");
        setMessage(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        className="flex-1 rounded-lg border border-border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <button
        type="submit"
        disabled={status === "loading"}
        className="rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
      >
        {status === "loading" ? "Joining..." : "Join waitlist"}
      </button>
      {status !== "idle" && (
        <p
          className={`sm:sr-only text-sm ${
            status === "success" ? "text-accent" : "text-red-500"
          }`}
        >
          {message}
        </p>
      )}
    </form>
  );
}

export default function Home() {
  return (
    <div className="bg-background">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-linear-to-br from-muted to-background opacity-80" />
        <div className="relative max-w-5xl mx-auto px-6 pt-20 pb-24 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground mb-6">
            <Zap className="w-3.5 h-3.5 text-accent" />
            Now open for early access
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-foreground max-w-3xl mx-auto leading-[1.1]">
            Pass your first SOC 2 audit without a $10,000 consultant.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
            PolicyForge generates a complete, auditor-grade policy pack mapped to your real stack
            — AWS, Google Workspace, GitHub, Slack, Stripe — in minutes, not weeks.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/intake"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Start your intake
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground hover:bg-muted transition-colors"
            >
              See pricing
            </Link>
          </div>

          <div className="mt-12 p-6 rounded-2xl border border-border bg-card/80 backdrop-blur max-w-xl mx-auto text-left">
            <p className="text-sm font-medium text-foreground mb-3">
              Get early access and pricing updates
            </p>
            <WaitlistForm />
          </div>
        </div>
      </section>

      {/* Value prop */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Everything you need for audit-ready policies
          </h2>
          <p className="mt-3 text-muted-foreground">
            One framework, one intake, one downloadable pack.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              icon: Shield,
              title: "Stack-aware policies",
              description:
                "Documents name your real systems — AWS, GCP, Azure, GitHub, Slack, Stripe — not generic placeholders.",
            },
            {
              icon: Map,
              title: "Control mapping",
              description:
                "Every policy maps to the controls your auditor will test, exported as a working spreadsheet.",
            },
            {
              icon: FileText,
              title: "Markdown + DOCX + CSV",
              description:
                "Download your pack in the formats auditors, consultants, and Vanta/Drata expect.",
            },
            {
              icon: Clock,
              title: "30-day edit window",
              description:
                "One free regeneration from your saved questionnaire, plus a redline diff so you can track changes.",
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-border bg-card p-6 hover:shadow-sm transition-shadow"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <feature.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">{feature.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust signals */}
      <section className="border-y border-border bg-muted/40">
        <div className="max-w-5xl mx-auto px-6 py-14">
          <div className="grid sm:grid-cols-3 gap-8 text-center">
            <div>
              <div className="text-3xl font-semibold text-foreground">15–25</div>
              <div className="text-sm text-muted-foreground mt-1">policies per pack</div>
            </div>
            <div>
              <div className="text-3xl font-semibold text-foreground">&lt; 10 min</div>
              <div className="text-sm text-muted-foreground mt-1">intake questionnaire</div>
            </div>
            <div>
              <div className="text-3xl font-semibold text-foreground">5 min</div>
              <div className="text-sm text-muted-foreground mt-1">generation time</div>
            </div>
          </div>
          <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Users className="w-4 h-4" />
            Built for 10–100 person B2B SaaS teams preparing for SOC 2 Type I or ISO 27001.
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-6 py-20 text-center">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          See what PolicyForge builds for you
        </h2>
        <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
          Start the free intake, preview one tailored policy, and unlock the full pack when you are
          ready.
        </p>
        <div className="mt-8">
          <Link
            href="/intake"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Start free intake
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Disclaimer footer */}
      <section className="border-t border-border bg-muted/40">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-5">
            <CheckCircle2 className="w-5 h-5 text-accent mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Important:</strong> PolicyForge is a
              document-generation tool, not a law firm or compliance consultancy. Generated policies
              are a tailored first draft, not legal advice, and should be reviewed by your auditor,
              compliance consultant, or legal counsel before submission. We do not provide legal
              opinions or certify compliance.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
