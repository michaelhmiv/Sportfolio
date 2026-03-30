import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const sections = [
  {
    title: "Information We Collect",
    body: [
      "Sportfolio collects information you provide when you create an account, including your email address, username, and profile information through authentication providers.",
      "We also collect data about your platform usage, including trading activity, boost participation, and portfolio performance.",
    ],
  },
  {
    title: "How We Use Your Information",
    body: [
      "We use your information to provide and improve Sportfolio's services, including processing trades, managing boosts, calculating leaderboards, and personalizing your experience.",
      "Your data helps us maintain platform security, prevent fraud, and communicate important updates about your account and the platform.",
    ],
  },
  {
    title: "Data Security",
    body: [
      "We implement industry-standard security measures to protect your personal information. Sensitive data is encrypted in transit and at rest.",
      "Authentication is managed through secure OAuth providers, and we never store your passwords directly.",
    ],
  },
  {
    title: "Third-Party Services",
    body: [
      "Sportfolio uses third-party services including authentication providers, analytics tools, and sports data APIs to deliver our services.",
      "These providers have their own privacy policies and data handling practices.",
    ],
  },
  {
    title: "Your Rights",
    body: [
      "You have the right to access, modify, or delete your personal information. You can update your profile information through your account settings.",
      "For data deletion requests, use the dedicated Delete Account page. For other privacy concerns, contact our support team.",
    ],
  },
  {
    title: "Cookies and Tracking",
    body: [
      "Sportfolio uses cookies and similar tracking technologies to maintain your login session, remember your preferences, and analyze platform usage.",
      "Essential cookies are required for the platform to function properly. Disabling certain cookies may impact functionality.",
    ],
  },
  {
    title: "Data Retention",
    body: [
      "We retain your account information and activity data for as long as your account remains active.",
      "Trading history, boost participation, and portfolio records are maintained so you can access your activity timeline and historical performance data.",
    ],
  },
  {
    title: "Children's Privacy",
    body: [
      "Sportfolio is not intended for users under the age of 13. We do not knowingly collect personal information from children under 13.",
    ],
  },
  {
    title: "Changes to This Policy",
    body: [
      "We may update this Privacy Policy periodically to reflect changes in our practices or legal requirements.",
      "Significant changes will be communicated through the platform or via email.",
    ],
  },
];

export default function Privacy() {
  return (
    <div className="terminal-page">
      <div className="mx-auto max-w-4xl p-6 md:p-12">
        <div className="terminal-shell mb-8 p-5 md:p-6">
          <div className="terminal-strip">Policy Reference</div>
          <h1 className="terminal-heading mt-4 text-3xl md:text-4xl" data-testid="heading-privacy">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-muted-foreground md:text-base">
            How Sportfolio collects, uses, and safeguards account and gameplay data.
          </p>
        </div>

        <div className="space-y-6">
          {sections.map(({ title, body }) => (
            <Card key={title} variant="terminal">
              <CardHeader>
                <CardTitle className="terminal-heading text-sm">{title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {body.map((paragraph) => (
                  <p key={paragraph} className="text-muted-foreground">
                    {paragraph}
                  </p>
                ))}
              </CardContent>
            </Card>
          ))}

          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading text-sm">Contact Us</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                For questions about this Privacy Policy, data access requests, privacy concerns, or
                account deletion, visit the Delete Account page or email
                {" "}
                <a
                  className="text-primary underline underline-offset-4"
                  href="mailto:sportfolioholdings@gmail.com"
                >
                  sportfolioholdings@gmail.com
                </a>
                .
              </p>
              <p className="text-muted-foreground">
                We aim to respond to privacy inquiries within 48 hours.
              </p>
            </CardContent>
          </Card>
        </div>

        <p className="terminal-subtle mt-8">Last updated: November 21, 2025</p>
      </div>
    </div>
  );
}
