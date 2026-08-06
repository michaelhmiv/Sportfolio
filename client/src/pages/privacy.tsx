import { DocumentSection, DocumentShell } from "@/components/surface-layout";
import { SPORTFOLIO_SUPPORT_EMAIL } from "@/lib/community-links";

const sections = [
  {
    id: "information-we-collect",
    title: "Information We Collect",
    body: [
      "Sportfolio collects information you provide when creating or maintaining an account, including your email address, username, profile information, and supported identity-provider information.",
      "We also collect gameplay and platform-usage data, including virtual trades, holdings, boosts, scouting activity, watchlists, collections, milestones, schedules, liquidity activity, and virtual portfolio performance.",
    ],
  },
  {
    id: "how-we-use-information",
    title: "How We Use Your Information",
    body: [
      "We use information to provide and improve Sportfolio, calculate game state and leaderboards, process supported virtual gameplay and account actions, personalize the experience, maintain security, prevent abuse, and communicate important service updates.",
      "Sportfolio does not sell personal information to advertisers.",
    ],
  },
  {
    id: "connected-ai-app",
    title: "ChatGPT and Codex App",
    body: [
      "When you voluntarily connect Sportfolio to ChatGPT or Codex, Sportfolio uses OAuth authorization to approve the connection. The app may return information needed for your request, such as public player data and your virtual holdings, balance, trades, scouts, watchlists, boosts, collections, milestones, schedules, liquidity, news, and profile.",
      "When you request a supported account or gameplay change, the app may transmit the tool inputs required to perform that action. Market trades, scouting, share stacking, boosts, community boosts, and liquidity operations use Sportfolio's staged preview and confirmation workflow before final execution. Other supported account changes may execute after a clear request.",
      "The app does not expose passwords, API keys, authentication codes, access tokens, refresh tokens, payment credentials, or private service configuration through ordinary tool results.",
      "OpenAI receives the tool inputs and results necessary to provide the connected experience under OpenAI's applicable terms and privacy practices. Sportfolio does not use connected-app conversations or tool inputs to train an independent AI model.",
      "You can revoke a ChatGPT or Codex OAuth grant from Sportfolio's Connected Applications page.",
    ],
  },
  {
    id: "logging-and-retention",
    title: "Operational Logging and Retention",
    body: [
      "Sportfolio records limited operational metadata for reliability and security, such as operation name, success or failure, duration, approximate payload size, and pseudonymous account or client identifiers.",
      "Sportfolio does not intentionally log OAuth authorization codes, access tokens, refresh tokens, authorization headers, passwords, complete tool results, or complete user prompts in normal operational telemetry.",
      "Operational logs are retained only as long as reasonably necessary for security, troubleshooting, legal obligations, and service reliability, then deleted or aggregated under applicable retention practices.",
    ],
  },
  {
    id: "data-security",
    title: "Data Security",
    body: [
      "We use administrative, technical, and organizational safeguards designed to protect personal information. Data is encrypted in transit, and sensitive service data is protected at rest where applicable.",
      "Authentication uses secure session controls and supported identity providers. Sportfolio does not store plaintext account passwords in application tables.",
      "Private-data and write tools require an authorized account connection. Tool responses are filtered to remove credential fields, authentication tokens, direct contact fields, debug data, stack traces, database details, session identifiers, and other restricted internal information.",
    ],
  },
  {
    id: "third-party-services",
    title: "Third-Party Services",
    body: [
      "Sportfolio uses service providers for authentication, hosting, databases, monitoring, payments, communications, sports data, and connected-app delivery. These providers process information subject to their own terms and our applicable agreements with them.",
      "Public sports information may originate from third-party or unofficial sports data sources and may be delayed, incomplete, or corrected after publication.",
    ],
  },
  {
    id: "rights-and-controls",
    title: "Your Rights and Controls",
    body: [
      "You may access or modify available profile information through account settings or supported connected-app tools, revoke connected applications, and request deletion through the dedicated Delete Account page.",
      "For other privacy requests, contact Sportfolio support. We may need to verify your identity before fulfilling a request.",
    ],
  },
  {
    id: "cookies-and-storage",
    title: "Cookies and Local Storage",
    body: [
      "Sportfolio uses cookies, local storage, and similar technologies to maintain authentication sessions, preserve preferences, support native and web functionality, and protect the service.",
      "Disabling required storage may prevent authentication, OAuth consent, or other essential features from working.",
    ],
  },
  {
    id: "data-retention",
    title: "Data Retention",
    body: [
      "We retain account and gameplay data while an account remains active and as reasonably necessary to provide historical activity, resolve disputes, enforce agreements, meet legal obligations, and maintain platform integrity.",
      "Pending action records, transaction history, audit records, and account-change records may be retained as reasonably necessary to prevent duplicate execution, investigate errors or abuse, and preserve gameplay integrity.",
      "Account deletion remains subject to legitimate legal, security, fraud-prevention, backup, and record-retention requirements.",
    ],
  },
  {
    id: "childrens-privacy",
    title: "Children's Privacy",
    body: [
      "Sportfolio is not intended for children under 13, and we do not knowingly collect personal information from children under 13.",
    ],
  },
  {
    id: "policy-changes",
    title: "Changes to This Policy",
    body: [
      "We may update this Privacy Policy to reflect changes in services, integrations, action capabilities, security practices, or legal requirements.",
      "Material changes will be communicated through the platform, the policy page, or another appropriate channel.",
    ],
  },
  {
    id: "contact",
    title: "Contact",
    body: [],
  },
] as const;

export default function Privacy() {
  return (
    <DocumentShell
      title="Privacy Policy"
      summary="How Sportfolio collects, uses, shares, retains, and safeguards account and gameplay information."
      effectiveDate="August 6, 2026"
      sections={sections}
    >
      {sections.map((section) => (
        <DocumentSection key={section.id} id={section.id} title={section.title}>
          {section.id === "contact" ? (
            <p>
              Questions about this policy, data access, connected applications, or account deletion may be sent to{" "}
              <a className="font-medium text-brand underline underline-offset-4" href={`mailto:${SPORTFOLIO_SUPPORT_EMAIL}`}>
                {SPORTFOLIO_SUPPORT_EMAIL}
              </a>
              .
            </p>
          ) : (
            section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)
          )}
        </DocumentSection>
      ))}
    </DocumentShell>
  );
}
