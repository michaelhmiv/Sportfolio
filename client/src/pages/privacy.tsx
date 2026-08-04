import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const sections = [
  {
    title: "Information We Collect",
    body: [
      "Sportfolio collects information you provide when you create an account, including your email address, username, and profile information through authentication providers.",
      "We also collect gameplay and platform-usage data, including virtual trades, holdings, boosts, scouting activity, watchlists, collections, milestones, schedules, liquidity activity, and virtual portfolio performance.",
    ],
  },
  {
    title: "How We Use Your Information",
    body: [
      "We use your information to provide and improve Sportfolio, calculate game state and leaderboards, process supported virtual gameplay and account actions, personalize your experience, maintain platform security, prevent abuse, and communicate important service updates.",
      "Sportfolio does not sell personal information to advertisers.",
    ],
  },
  {
    title: "ChatGPT and Codex App",
    body: [
      "When you voluntarily connect Sportfolio to ChatGPT or Codex, Sportfolio uses OAuth 2.1 to authorize the connection. The app may return the Sportfolio information needed for your request, such as public player data and your virtual holdings, balance, trades, scouts, watchlists, boosts, collections, milestones, schedules, liquidity, news, profile, and supported agent state.",
      "When you request a supported account or gameplay change, the app may transmit the tool inputs required to perform that action. Market trades, scouting, share stacking, boosts, community boosts, and liquidity operations use Sportfolio's staged preview and confirmation workflow before final execution. Other supported account changes may execute immediately after a clear request.",
      "The app does not expose your password, API keys, provider keys, authentication codes, SMS verification codes, access tokens, refresh tokens, payment credentials, or private service configuration through ordinary tool results. Certain credential, token, SMS-link, or provider-key management workflows may accept sensitive input only when you specifically initiate that account-security feature; you should never paste those values into ordinary conversation unless the approved connection interface explicitly requires them.",
      "OpenAI receives the tool inputs and tool results necessary to provide the app experience under OpenAI's applicable terms and privacy practices. Sportfolio does not use app conversations or tool inputs to train an independent AI model.",
      "You can revoke a ChatGPT or Codex OAuth grant from Sportfolio's Connected Applications page. Revocation invalidates the connection's refresh access, although short-lived access may remain valid until expiration where required by the authorization protocol.",
    ],
  },
  {
    title: "App Logging and Retention",
    body: [
      "Sportfolio records limited operational metadata for app reliability and security, such as tool name, success or failure, duration, approximate payload size, and pseudonymous account and client identifiers.",
      "Sportfolio does not intentionally log OAuth authorization codes, access tokens, refresh tokens, authorization headers, passwords, complete tool results, or complete user prompts in normal app telemetry.",
      "Operational logs are retained only as long as reasonably necessary for security, troubleshooting, legal obligations, and service reliability, then deleted or aggregated under our retention practices.",
    ],
  },
  {
    title: "Data Security",
    body: [
      "We use administrative, technical, and organizational safeguards designed to protect personal information. Data is encrypted in transit, and sensitive service data is protected at rest where applicable.",
      "Authentication is managed through Supabase Auth and supported identity providers. Sportfolio does not store your password in application tables.",
      "Private-data and write tools require an authorized account connection. Tool responses are filtered to remove credential fields, authentication tokens, direct contact fields, debug data, stack traces, SQL details, session identifiers, and other restricted internal information.",
    ],
  },
  {
    title: "Third-Party Services",
    body: [
      "Sportfolio uses service providers for authentication, hosting, databases, error monitoring, payments, communications, sports data, and connected AI-app delivery. These providers process information subject to their own terms and our applicable agreements with them.",
      "Public sports information may originate from third-party or unofficial sports data sources and may be delayed, incomplete, or corrected after publication.",
    ],
  },
  {
    title: "Your Rights and Controls",
    body: [
      "You may access or modify available profile information through account settings or supported connected-app tools, revoke connected applications, and request deletion through the dedicated Delete Account page.",
      "For other privacy requests, contact sportfolioholdings@gmail.com. We may need to verify your identity before fulfilling a request.",
    ],
  },
  {
    title: "Cookies and Local Storage",
    body: [
      "Sportfolio uses cookies, local storage, and similar technologies to maintain authentication sessions, preserve preferences, support native and web functionality, and protect the service.",
      "Disabling required storage may prevent authentication, OAuth consent, or other essential features from working.",
    ],
  },
  {
    title: "Data Retention",
    body: [
      "We retain account and gameplay data while your account remains active and as reasonably necessary to provide historical activity, resolve disputes, enforce agreements, meet legal obligations, and maintain platform integrity.",
      "Pending action records, transaction history, audit records, and account-change records may be retained as reasonably necessary to prevent duplicate execution, investigate errors or abuse, and preserve gameplay integrity.",
      "Account deletion is subject to legitimate legal, security, fraud-prevention, backup, and record-retention requirements.",
    ],
  },
  {
    title: "Children's Privacy",
    body: [
      "Sportfolio is not intended for children under 13, and we do not knowingly collect personal information from children under 13.",
    ],
  },
  {
    title: "Changes to This Policy",
    body: [
      "We may update this Privacy Policy to reflect changes in our services, integrations, action capabilities, security practices, or legal requirements.",
      "Material changes will be communicated through the platform, the policy page, or other appropriate channels.",
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
            How Sportfolio collects, uses, shares, and safeguards account and gameplay data.
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
                For questions about this Privacy Policy, data access requests, connected-application
                concerns, or account deletion, visit the Delete Account page or email{" "}
                <a
                  className="text-primary underline underline-offset-4"
                  href="mailto:sportfolioholdings@gmail.com"
                >
                  sportfolioholdings@gmail.com
                </a>
                .
              </p>
            </CardContent>
          </Card>
        </div>

        <p className="terminal-subtle mt-8">Effective and last updated: August 3, 2026</p>
      </div>
    </div>
  );
}
