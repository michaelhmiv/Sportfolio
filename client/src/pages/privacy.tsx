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
    id: "public-profiles-and-safety",
    title: "Public Profiles and Safety Controls",
    body: [
      "If your Sportfolio profile is public, other users may see user-selected profile information such as your username, profile image, and eligible public trophy-case content. You can change supported profile visibility settings from your account controls.",
      "Signed-in users can report public profile content for moderation review and can block another user's public profile from their own account. A profile report stores the reporting user, the reported account, the selected reason, optional report details, and a snapshot of the reported username and profile-image reference so the report can be investigated even if the profile later changes.",
      "A block records the relationship between the blocking account and blocked account and is used to hide that user's public profile content from the blocker. Blocks can be removed by the blocking user.",
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
    id: "rewarded-advertising",
    title: "Rewarded Advertising",
    body: [
      "Sportfolio's native mobile apps may offer optional rewarded ads through Google Mobile Ads. A user may choose to watch a rewarded ad to receive a temporary virtual gameplay benefit, such as additional scout capacity. The reward is optional and is not a cash prize or redeemable item.",
      "For the current rewarded scout boost flow, Sportfolio requests non-personalized ad serving. Google and participating advertising providers may still process information needed to deliver, measure, secure, and prevent abuse of ads, such as device or network information, approximate location derived from network information, diagnostics, and ad interactions, subject to their applicable privacy practices.",
      "After a rewarded ad is shown, Sportfolio may retain limited ad diagnostic context on the device, such as the ad response identifier, mediation adapter name, platform, and time shown. This context is used to help identify an ad if the user chooses Support > Report an ad. It is not used by Sportfolio to build an advertising profile.",
      "Users can report inappropriate or age-inappropriate ads through the in-app Support page. Reports may include the available ad diagnostic context so Sportfolio can investigate the ad with the advertising provider.",
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
      "Sportfolio uses service providers for authentication, hosting, databases, monitoring, payments, communications, advertising, sports data, and connected-app delivery. These providers process information subject to their own terms and our applicable agreements with them.",
      "Public sports information may originate from third-party or unofficial sports data sources and may be delayed, incomplete, or corrected after publication.",
    ],
  },
  {
    id: "rights-and-controls",
    title: "Your Rights and Controls",
    body: [
      "You may access or modify available profile information through account settings or supported connected-app tools, change supported public-profile visibility, report or block public profiles, revoke connected applications, and request deletion through the dedicated Delete Account page.",
      "For other privacy requests, contact Sportfolio support. We may need to verify your identity before fulfilling a request.",
    ],
  },
  {
    id: "cookies-and-storage",
    title: "Cookies and Local Storage",
    body: [
      "Sportfolio uses cookies, local storage, and similar technologies to maintain authentication sessions, preserve preferences, support native and web functionality, retain limited rewarded-ad report context, and protect the service.",
      "Disabling required storage may prevent authentication, OAuth consent, or other essential features from working.",
    ],
  },
  {
    id: "data-retention",
    title: "Data Retention",
    body: [
      "We retain account and gameplay data while an account remains active and as reasonably necessary to provide historical activity, resolve disputes, enforce agreements, meet legal obligations, and maintain platform integrity.",
      "Pending action records, transaction history, audit records, profile-safety reports and blocks, and account-change records may be retained as reasonably necessary to prevent duplicate execution, investigate errors or abuse, preserve safety controls, and maintain gameplay integrity.",
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
      effectiveDate="August 11, 2026"
      sections={sections}
    >
      {sections.map((section) => (
        <DocumentSection key={section.id} id={section.id} title={section.title}>
          {section.id === "contact" ? (
            <p>
              Questions about this policy, data access, connected applications, advertising, ad
              reports, profile safety, or account deletion may be sent to{" "}
              <a
                className="font-medium text-brand underline underline-offset-4"
                href={`mailto:${SPORTFOLIO_SUPPORT_EMAIL}`}
              >
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
