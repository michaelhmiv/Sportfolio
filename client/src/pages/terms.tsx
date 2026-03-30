import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const sections = [
  {
    title: "Acceptance of Terms",
    body: [
      "By accessing and using Sportfolio, you accept and agree to be bound by these Terms of Service.",
      "Sportfolio is a fantasy sports platform where you trade virtual shares representing NBA players and use virtual gameplay systems tied to live sports outcomes.",
    ],
  },
  {
    title: "User Accounts",
    body: [
      "You must create an account to use Sportfolio's features. You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account.",
      "You must be at least 13 years old to use this platform.",
    ],
  },
  {
    title: "Virtual Currency and Trading",
    body: [
      "Sportfolio uses virtual currency for trades, boosts, and other platform systems. Virtual currency has no real-world monetary value and cannot be exchanged for money or prizes.",
      "All activity is for entertainment purposes only.",
    ],
  },
  {
    title: "Boost Rules",
    body: [
      "Boosts are optional gameplay mechanics that let users commit eligible shares to slot-based outcomes tied to real game performance.",
      "Boost results and any related virtual payouts are governed by the live rules displayed in-product at the time of use.",
    ],
  },
  {
    title: "User Conduct",
    body: [
      "Users must not engage in cheating, exploit bugs, harass other users, or disrupt platform operations.",
      "We reserve the right to suspend or terminate accounts that violate these terms.",
    ],
  },
  {
    title: "Data and Privacy",
    body: [
      "Your use of Sportfolio is also governed by our Privacy Policy. We collect and use data as described there to provide and improve our services.",
    ],
  },
  {
    title: "Intellectual Property",
    body: [
      "All content on Sportfolio, including text, graphics, logos, code, and software, is the property of Sportfolio or its licensors and is protected by copyright and intellectual property laws.",
      "You may not reproduce, distribute, or create derivative works from Sportfolio content without explicit permission.",
    ],
  },
  {
    title: "Limitation of Liability",
    body: [
      'Sportfolio is provided "as is" without warranties of any kind. We are not liable for damages arising from your use of the platform, including loss of data or interruption of service.',
      "Virtual currency on Sportfolio has no monetary value, and we are not responsible for any perceived value or loss of virtual assets.",
    ],
  },
  {
    title: "Account Termination",
    body: [
      "We reserve the right to suspend or terminate accounts that violate these terms, engage in fraudulent activity, or disrupt platform operations.",
      "You may also request account deletion at any time through the dedicated Delete Account page.",
    ],
  },
  {
    title: "Dispute Resolution",
    body: [
      "Any disputes arising from your use of Sportfolio will be resolved through binding arbitration. You agree to waive your right to participate in class action lawsuits against Sportfolio.",
    ],
  },
  {
    title: "Modifications",
    body: [
      "We may modify these Terms of Service at any time. We will notify users of significant changes via email or platform announcements.",
      "Continued use of the platform after changes constitutes acceptance of the modified terms.",
    ],
  },
];

export default function Terms() {
  return (
    <div className="terminal-page">
      <div className="mx-auto max-w-4xl p-6 md:p-12">
        <div className="terminal-shell mb-8 p-5 md:p-6">
          <div className="terminal-strip">Service Terms</div>
          <h1 className="terminal-heading mt-4 text-3xl md:text-4xl" data-testid="heading-terms">
            Terms of Service
          </h1>
          <p className="mt-3 text-sm text-muted-foreground md:text-base">
            Operational rules and account responsibilities for using Sportfolio.
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
              <CardTitle className="terminal-heading text-sm">Contact Information</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                If you have questions about these Terms of Service, contact us through the Discord
                community or the contact page. We aim to respond within 48 hours.
              </p>
            </CardContent>
          </Card>
        </div>

        <p className="terminal-subtle mt-8">Last updated: November 21, 2025</p>
      </div>
    </div>
  );
}
