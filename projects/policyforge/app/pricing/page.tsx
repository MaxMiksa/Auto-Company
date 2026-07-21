"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ArrowRight, Shield, Mail } from "lucide-react";

type Variant = "a" | "b";

function getSearchVariant(): Variant | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const v = params.get("variant");
  return v === "a" || v === "b" ? v : null;
}

function getCookieVariant(): Variant | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )pf_starter_variant=([^;]+)/);
  const v = match?.[1];
  return v === "a" || v === "b" ? v : null;
}

function setVariantCookie(v: Variant) {
  const maxAge = 60 * 60 * 24 * 28;
  document.cookie = `pf_starter_variant=${v}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export default function Pricing() {
  const [variant, setVariant] = useState<Variant | null>(null);

  useEffect(() => {
    let v = getSearchVariant() || getCookieVariant();
    if (!v) {
      v = Math.random() < 0.5 ? "a" : "b";
    }
    setVariant(v);
    setVariantCookie(v);
  }, []);

  if (!variant) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-24 text-center text-muted-foreground">
        Loading pricing…
      </div>
    );
  }

  const starterPrice = variant === "b" ? 249 : 199;

  const tiers = [
    {
      name: "Starter",
      price: `$${starterPrice}`,
      priceDetail: "one-time",
      description: "Full 15–25 policy pack + control map, 30-day edits.",
      features: [
        "One framework (SOC 2 Type I or ISO 27001:2022)",
        "15–25 tailored policies",
        "Control-mapping CSV",
        "Markdown + DOCX export",
        "30-day edit / one regeneration",
      ],
      cta: "Get Starter",
      href: "/intake",
      variant,
    },
    {
      name: "Growth",
      price: "$499",
      priceDetail: "/year",
      description: "Annual review, evidence checklist, and email support.",
      features: [
        "Everything in Starter",
        "Annual policy review & redline",
        "Evidence checklist",
        "Email support",
        "SOC 2 or ISO 27001:2022",
      ],
      cta: "Get Growth",
      href: "/intake",
      popular: true,
    },
    {
      name: "Scale",
      price: "$999",
      priceDetail: "/year",
      description: "Multi-framework, gap-analysis checklist, and priority support.",
      features: [
        "Everything in Growth",
        "Multi-framework packs",
        "Gap-analysis checklist (CSV)",
        "Annual refresh",
        "Priority support",
      ],
      cta: "Get Scale",
      href: "/intake",
    },
    {
      name: "Audit Assist",
      price: "$2,500+",
      priceDetail: "custom",
      description: "Human review, advisory, and custom scope.",
      features: [
        "Everything in Scale",
        "Scoping call with a compliance advisor",
        "Policy review & edit pass",
        "Custom framework support",
        "Consulting-style engagement",
      ],
      cta: "Request a call",
      href: "mailto:hello@policyforge.auto-company.dev?subject=Audit%20Assist%20inquiry",
    },
  ];

  return (
    <div className="bg-background">
      <section className="border-b border-border bg-muted/40">
        <div className="max-w-5xl mx-auto px-6 py-16 text-center">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            Simple pricing for first-audit teams
          </h1>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            Choose a one-time pack or an annual plan. Every plan includes our
            “not legal advice” disclaimer and a 30-day review window.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-2xl border p-6 flex flex-col ${
                tier.popular
                  ? "border-primary bg-card shadow-sm"
                  : "border-border bg-card"
              }`}
            >
              {tier.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                  Most popular
                </span>
              )}
              <div className="mb-4">
                <h3 className="text-lg font-semibold">{tier.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {tier.description}
                </p>
              </div>
              <div className="mb-6">
                <span className="text-4xl font-bold tracking-tight">
                  {tier.price}
                </span>
                <span className="text-muted-foreground text-sm ml-1">
                  {tier.priceDetail}
                </span>
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {tier.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <Check className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href={tier.href}
                className={`inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors ${
                  tier.popular
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border border-border hover:bg-muted text-foreground"
                }`}
              >
                {tier.cta}
                {tier.name !== "Audit Assist" && (
                  <ArrowRight className="w-4 h-4" />
                )}
                {tier.name === "Audit Assist" && <Mail className="w-4 h-4" />}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-5">
            <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              Pricing is billed annually for Growth and Scale. The Starter tier is a one-time
              purchase. Audit Assist is a separate advisory engagement and is not included in
              self-serve plans. All outputs are tailored first drafts, not legal advice. Review
              with your auditor, compliance consultant, or legal counsel before submission.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
