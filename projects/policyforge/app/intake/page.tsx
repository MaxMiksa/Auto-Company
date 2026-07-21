"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Shield } from "lucide-react";

const STORAGE_KEY = "policyforge_intake";

type IntakeData = {
  screener: {
    framework: string;
    auditTimeline: string;
    hasConsultant: string;
  };
  company: {
    companyName: string;
    teamSize: string;
    industry: string;
    geography: string;
  };
  stack: {
    cloud: string[];
    identity: string[];
    code: string[];
    chat: string[];
    payment: string[];
    other: string;
  };
  practices: {
    managedDevices: string;
    mfa: string;
    accessReviews: string;
    incidentPlan: string;
    backups: string;
    dataTypes: string[];
    notes: string;
  };
};

const defaults: IntakeData = {
  screener: {
    framework: "soc2",
    auditTimeline: "3-6mo",
    hasConsultant: "no",
  },
  company: {
    companyName: "",
    teamSize: "11-50",
    industry: "saas",
    geography: "us",
  },
  stack: {
    cloud: ["aws"],
    identity: ["google"],
    code: ["github"],
    chat: ["slack"],
    payment: ["stripe"],
    other: "",
  },
  practices: {
    managedDevices: "some",
    mfa: "yes",
    accessReviews: "annually",
    incidentPlan: "draft",
    backups: "yes",
    dataTypes: ["pii"],
    notes: "",
  },
};

function toggleItem(list: string[], value: string) {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export default function Intake() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<IntakeData>(defaults);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setData((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore corrupt localStorage
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  const steps = [
    { label: "Screener" },
    { label: "Company" },
    { label: "Stack" },
    { label: "Practices" },
  ];

  const progress = Math.round((step / (steps.length - 1)) * 100);

  const update = <K extends keyof IntakeData>(
    section: K,
    field: keyof IntakeData[K],
    value: IntakeData[K][keyof IntakeData[K]]
  ) => {
    setData((prev) => ({
      ...prev,
      [section]: { ...prev[section], [field]: value },
    }));
  };

  const canProceed = () => {
    if (step === 0) {
      return (
        data.screener.framework &&
        data.screener.auditTimeline &&
        data.screener.hasConsultant
      );
    }
    if (step === 1) {
      return data.company.companyName.trim() !== "";
    }
    return true;
  };

  const handleSubmit = () => {
    // For now, persist to localStorage only and show a success state.
    // A future route can POST to /api/intake for server-side persistence.
    console.log("Intake submitted:", data);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-24 text-center">
        <div className="rounded-2xl border border-border bg-card p-10">
          <CheckCircle2 className="w-12 h-12 text-accent mx-auto mb-4" />
          <h1 className="text-2xl font-semibold">Intake saved</h1>
          <p className="mt-3 text-muted-foreground">
            Your answers are saved in this browser. We&apos;ll use them to generate your tailored
            policy pack when generation is enabled.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background pb-20">
      <div className="border-b border-border bg-muted/40">
        <div className="max-w-3xl mx-auto px-6 py-10">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Compliance intake
          </h1>
          <p className="mt-2 text-muted-foreground">
            A short diagnostic about your company, stack, and practices. Most teams finish in under
            10 minutes.
          </p>
          <div className="mt-6 flex items-center gap-2 rounded-xl border border-border bg-card p-4">
            <Shield className="w-5 h-5 text-primary shrink-0" />
            <p className="text-sm text-muted-foreground">
              This is a diagnostic, not legal advice. Answers are stored locally in this browser.
              Do not enter credentials, tokens, or secrets.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 mt-8">
        <div className="mb-6">
          <div className="flex items-center justify-between text-sm font-medium mb-2">
            <span className="text-foreground">{steps[step].label}</span>
            <span className="text-muted-foreground">
              {step + 1} of {steps.length}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          {step === 0 && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold">Screener</h2>
              <div>
                <label className="block text-sm font-medium mb-2">Which framework?</label>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={data.screener.framework}
                  onChange={(e) => update("screener", "framework", e.target.value)}
                >
                  <option value="soc2">SOC 2 Type I</option>
                  <option value="iso27001">ISO 27001:2022</option>
                  <option value="both">Both — SOC 2 + ISO 27001</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  When do you expect your first audit?
                </label>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={data.screener.auditTimeline}
                  onChange={(e) => update("screener", "auditTimeline", e.target.value)}
                >
                  <option value="lt3mo">Less than 3 months</option>
                  <option value="3-6mo">3–6 months</option>
                  <option value="6-12mo">6–12 months</option>
                  <option value="gt12mo">More than 12 months</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  Do you have a compliance consultant or auditor already?
                </label>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={data.screener.hasConsultant}
                  onChange={(e) => update("screener", "hasConsultant", e.target.value)}
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                  <option value="unsure">Not sure yet</option>
                </select>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold">Company basics</h2>
              <div>
                <label className="block text-sm font-medium mb-2">Company name</label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={data.company.companyName}
                  onChange={(e) => update("company", "companyName", e.target.value)}
                  placeholder="Acme Inc."
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Team size</label>
                  <select
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={data.company.teamSize}
                    onChange={(e) => update("company", "teamSize", e.target.value)}
                  >
                    <option value="1-10">1–10</option>
                    <option value="11-50">11–50</option>
                    <option value="51-100">51–100</option>
                    <option value="101-250">101–250</option>
                    <option value="250+">250+</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Industry</label>
                  <select
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={data.company.industry}
                    onChange={(e) => update("company", "industry", e.target.value)}
                  >
                    <option value="saas">B2B SaaS</option>
                    <option value="fintech">Fintech</option>
                    <option value="healthcare">Healthcare / Healthtech</option>
                    <option value="ecommerce">E-commerce</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Primary geography</label>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={data.company.geography}
                  onChange={(e) => update("company", "geography", e.target.value)}
                >
                  <option value="us">United States</option>
                  <option value="uk">United Kingdom</option>
                  <option value="eu">European Union</option>
                  <option value="ca">Canada</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold">Tools and vendors</h2>

              {[
                {
                  label: "Cloud provider",
                  field: "cloud" as const,
                  options: [
                    { value: "aws", label: "AWS" },
                    { value: "gcp", label: "Google Cloud" },
                    { value: "azure", label: "Azure" },
                    { value: "other", label: "Other / self-hosted" },
                  ],
                },
                {
                  label: "Identity / email provider",
                  field: "identity" as const,
                  options: [
                    { value: "google", label: "Google Workspace" },
                    { value: "microsoft", label: "Microsoft 365" },
                    { value: "okta", label: "Okta" },
                    { value: "jumpcloud", label: "JumpCloud" },
                    { value: "other", label: "Other" },
                  ],
                },
                {
                  label: "Code repository",
                  field: "code" as const,
                  options: [
                    { value: "github", label: "GitHub" },
                    { value: "gitlab", label: "GitLab" },
                    { value: "bitbucket", label: "Bitbucket" },
                    { value: "other", label: "Other" },
                  ],
                },
                {
                  label: "Chat / collaboration",
                  field: "chat" as const,
                  options: [
                    { value: "slack", label: "Slack" },
                    { value: "teams", label: "Microsoft Teams" },
                    { value: "discord", label: "Discord" },
                    { value: "other", label: "Other" },
                  ],
                },
                {
                  label: "Payments / billing",
                  field: "payment" as const,
                  options: [
                    { value: "stripe", label: "Stripe" },
                    { value: "chargebee", label: "Chargebee" },
                    { value: "paypal", label: "PayPal" },
                    { value: "other", label: "Other" },
                  ],
                },
              ].map((group) => (
                <div key={group.field}>
                  <label className="block text-sm font-medium mb-2">{group.label}</label>
                  <div className="flex flex-wrap gap-3">
                    {group.options.map((opt) => (
                      <label
                        key={opt.value}
                        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          className="rounded border-border"
                          checked={data.stack[group.field].includes(opt.value)}
                          onChange={() =>
                            update(
                              "stack",
                              group.field,
                              toggleItem(data.stack[group.field], opt.value)
                            )
                          }
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              <div>
                <label className="block text-sm font-medium mb-2">
                  Other tools or vendors (comma separated)
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={data.stack.other}
                  onChange={(e) => update("stack", "other", e.target.value)}
                  placeholder="Notion, Linear, Datadog, Sentry…"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold">Security practices</h2>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Do employees use company-managed devices?
                </label>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={data.practices.managedDevices}
                  onChange={(e) => update("practices", "managedDevices", e.target.value)}
                >
                  <option value="yes">Yes, all or most</option>
                  <option value="some">Some / BYOD mix</option>
                  <option value="no">No / mostly BYOD</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Is MFA required for critical systems?
                </label>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={data.practices.mfa}
                  onChange={(e) => update("practices", "mfa", e.target.value)}
                >
                  <option value="yes">Yes, enforced</option>
                  <option value="partial">Partially / recommended</option>
                  <option value="no">No</option>
                  <option value="unsure">Not sure</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  How often do you review access?
                </label>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={data.practices.accessReviews}
                  onChange={(e) => update("practices", "accessReviews", e.target.value)}
                >
                  <option value="quarterly">Quarterly</option>
                  <option value="annually">Annually</option>
                  <option value="onboarding">Only on onboarding/offboarding</option>
                  <option value="never">Never / ad-hoc</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Do you have an incident response plan?
                </label>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={data.practices.incidentPlan}
                  onChange={(e) => update("practices", "incidentPlan", e.target.value)}
                >
                  <option value="yes">Yes, documented</option>
                  <option value="draft">Draft / informal</option>
                  <option value="no">No</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Do you back up critical data?
                </label>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={data.practices.backups}
                  onChange={(e) => update("practices", "backups", e.target.value)}
                >
                  <option value="yes">Yes, automated cloud backups</option>
                  <option value="partial">Partial / manual</option>
                  <option value="no">No</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  What types of sensitive data do you handle?
                </label>
                <div className="flex flex-wrap gap-3">
                  {[
                    { value: "pii", label: "Customer PII" },
                    { value: "financial", label: "Financial data" },
                    { value: "phi", label: "PHI / health data" },
                    { value: "none", label: "Nothing especially sensitive" },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-border"
                        checked={data.practices.dataTypes.includes(opt.value)}
                        onChange={() =>
                          update(
                            "practices",
                            "dataTypes",
                            toggleItem(data.practices.dataTypes, opt.value)
                          )
                        }
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Notes for your reviewer</label>
                <textarea
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm min-h-[100px]"
                  value={data.practices.notes}
                  onChange={(e) => update("practices", "notes", e.target.value)}
                  placeholder="Anything else that affects your policies or controls..."
                />
              </div>
            </div>
          )}

          <div className="mt-10 flex items-center justify-between">
            <button
              type="button"
              disabled={step === 0}
              onClick={() => setStep((s) => s - 1)}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
            {step < steps.length - 1 ? (
              <button
                type="button"
                disabled={!canProceed()}
                onClick={() => setStep((s) => s + 1)}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                className="inline-flex items-center gap-1 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground hover:bg-accent/90"
              >
                Save intake
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
