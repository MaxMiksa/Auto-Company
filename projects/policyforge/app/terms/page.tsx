import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — PolicyForge",
  description: "PolicyForge terms of service and acceptable use policy.",
};

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight mb-6">Terms of Service</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Last updated: {new Date().toISOString().split("T")[0]}
      </p>

      <div className="prose prose-neutral dark:prose-invert max-w-none">
        <p>
          By using PolicyForge, you agree to these Terms of Service. If you do not agree,
          please do not use the service.
        </p>

        <h2>1. Service Description</h2>
        <p>
          PolicyForge is a document-generation tool that creates compliance policy templates
          based on the information you provide. We do not provide legal, compliance, or audit
          advisory services.
        </p>

        <h2>2. Account and Payment</h2>
        <p>
          Some features require payment. Fees are non-refundable unless required by law. You
          are responsible for maintaining the confidentiality of your account credentials.
        </p>

        <h2>3. Acceptable Use</h2>
        <p>
          You may not use PolicyForge to generate content that is unlawful, fraudulent,
          discriminatory, or infringing. We reserve the right to suspend accounts that violate
          this policy.
        </p>

        <h2>4. Generated Content</h2>
        <p>
          Generated policies are starting drafts, not final legal documents. You are responsible
          for reviewing, customizing, and validating them with your auditor, legal counsel, or
          compliance consultant before use.
        </p>

        <h2>5. Limitation of Liability</h2>
        <p>
          PolicyForge is provided “as is” without warranties of any kind. To the maximum extent
          permitted by law, our liability is limited to the amount you paid for the service in
          the twelve months preceding the claim.
        </p>

        <h2>6. Changes to Terms</h2>
        <p>
          We may update these terms at any time. Continued use of the service after changes
          means you accept the updated terms.
        </p>

        <h2>7. Contact</h2>
        <p>
          For questions about these terms, contact us at{" "}
          <a href="mailto:hello@policyforge.io" className="text-primary hover:underline">
            hello@policyforge.io
          </a>
          .
        </p>
      </div>
    </div>
  );
}
