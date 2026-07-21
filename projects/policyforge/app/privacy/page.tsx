import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — PolicyForge",
  description: "How PolicyForge collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight mb-6">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Last updated: {new Date().toISOString().split("T")[0]}
      </p>

      <div className="prose prose-neutral dark:prose-invert max-w-none">
        <p>
          This Privacy Policy explains how PolicyForge collects, uses, stores, and protects
          your information when you use our website and services.
        </p>

        <h2>1. Information We Collect</h2>
        <p>
          We collect the email address you provide when joining the waitlist or creating an
          account, information you enter into intake questionnaires, and standard analytics
          data about how you use the site.
        </p>

        <h2>2. How We Use Your Information</h2>
        <p>
          We use your information to provide and improve the service, communicate with you
          about your account and product updates, and understand usage patterns.
        </p>

        <h2>3. Data Storage and Security</h2>
        <p>
          We use industry-standard hosting and storage providers. Access is limited to those
          who need it to operate the service. We do not sell your personal information.
        </p>

        <h2>4. Cookies and Analytics</h2>
        <p>
          We may use cookies and analytics tools to measure traffic and improve the user
          experience. You can control cookies through your browser settings.
        </p>

        <h2>5. Data Retention</h2>
        <p>
          We retain your information as long as your account is active or as needed to provide
          the service. You may request deletion of your personal data by contacting us.
        </p>

        <h2>6. Your Rights</h2>
        <p>
          Depending on your location, you may have rights to access, correct, delete, or
          restrict processing of your personal data. Contact us to exercise these rights.
        </p>

        <h2>7. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify users of material
          changes by email or by posting a notice on the site.
        </p>

        <h2>8. Contact</h2>
        <p>
          For privacy questions or data requests, contact us at{" "}
          <a href="mailto:hello@policyforge.io" className="text-primary hover:underline">
            hello@policyforge.io
          </a>
          .
        </p>
      </div>
    </div>
  );
}
