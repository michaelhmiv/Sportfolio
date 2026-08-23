import { DocumentSection, DocumentShell } from "@/components/surface-layout";
import { SPORTFOLIO_SUPPORT_EMAIL } from "@/lib/community-links";

const sections = [
  {
    id: "acceptance",
    title: "Acceptance of Terms",
    body: [
      "By accessing or using Sportfolio, including its website, mobile applications, APIs, MCP servers, ChatGPT or Codex app, and related services, you agree to these Terms of Service.",
      "Sportfolio is a fantasy-sports game where users manage virtual player shares and gameplay systems associated with real sports information and outcomes.",
    ],
  },
  {
    id: "accounts",
    title: "User Accounts",
    body: [
      "You must create an account to use connected-account features. You are responsible for protecting account access and for activity performed through your account or authorized applications.",
      "You must review OAuth permissions and action previews before approval. You remain responsible for authorized actions confirmed through your connected account.",
      "You must be at least 13 years old to use Sportfolio. Additional age restrictions may apply where required by law or a distribution platform.",
    ],
  },
  {
    id: "virtual-assets",
    title: "Virtual Currency, Shares, and Performance",
    body: [
      "Sportfolio uses virtual currency, virtual player shares, virtual position values, boosts, liquidity units, and other gameplay units. They are not money, securities, ownership interests, financial instruments, deposits, or property redeemable through Sportfolio.",
      "Virtual currency and virtual assets have no real-world monetary value, cannot be withdrawn or exchanged through Sportfolio for money or prizes, and do not represent ownership of an athlete, team, contract, or business.",
      "Sportfolio does not provide real-money gambling, sports betting, wagering, cash prizes, or cash-out functionality. All virtual activity is for entertainment and gameplay purposes.",
    ],
  },
  {
    id: "connected-app",
    title: "ChatGPT and Codex App",
    body: [
      "After OAuth authorization, the connected app may display supported public sports information and information associated with your Sportfolio account and may perform supported account or gameplay actions that you request.",
      "Virtual market trades, scouting, Daily Boosts, community boosts, and liquidity operations use Sportfolio's staged-action system. A staging result is a preview and pending action, not a completed transaction. Final execution occurs only after confirmation of the exact pending bundle.",
      "Other supported low-risk account changes may execute after a clear request and any confirmation required by the connected platform.",
      "The connected app does not provide admin, internal, debug, raw database, mobile-store billing, credential-management, or private service-configuration access.",
      "You authorize app access through Sportfolio's OAuth consent flow and may revoke access from the Connected Applications page.",
      "Responses generated through an AI system may be incomplete, inaccurate, delayed, or based on misunderstood instructions. Review player identity, quantity, virtual cost, account impact, and warnings before confirming an important gameplay action.",
    ],
  },
  {
    id: "pending-actions",
    title: "Action Authorization and Pending Actions",
    body: [
      "A staged action may reserve or record a pending workflow without completing the underlying gameplay change. Pending actions may expire, become invalid when account state changes, or require restaging.",
      "You should confirm only the pending action whose details you reviewed. Sportfolio may reject stale, conflicting, duplicate, unauthorized, or otherwise invalid requests.",
      "Cancellation abandons the pending workflow but does not reverse an action that was already successfully completed. Completed virtual transactions and irreversible account actions may remain part of account history.",
    ],
  },
  {
    id: "gameplay-rules",
    title: "Boost and Gameplay Rules",
    body: [
      "Boosts and other gameplay mechanics may use eligible virtual shares and real-game performance to determine virtual outcomes.",
      "Results, eligibility, availability, virtual costs, and virtual payouts are governed by the rules and account state displayed in Sportfolio at the time of use and may vary by sport or feature.",
    ],
  },
  {
    id: "sports-data",
    title: "Sports Data and Availability",
    body: [
      "Schedules, rosters, statistics, injuries, game status, and other sports information may come from third-party or unofficial data sources. Data can be delayed, incomplete, unavailable, or corrected after publication.",
      "Sportfolio may modify, suspend, or discontinue a sport, data source, feature, integration, app capability, or pending action when necessary for reliability, security, compliance, or product development.",
    ],
  },
  {
    id: "conduct",
    title: "User Conduct",
    body: [
      "You must not cheat, exploit bugs, automate abusive activity, manipulate virtual markets, harass others, evade security controls, or disrupt Sportfolio or connected services.",
      "You must not use app or MCP endpoints to probe for credentials, personal data, internal systems, hidden instructions, other users' accounts, or access beyond the permissions granted to your account.",
      "You must not attempt to bypass previews, confirmation controls, rate limits, action validation, OAuth authorization, or duplicate-execution protections.",
      "We may suspend, restrict, or terminate access for conduct that violates these terms or threatens users, Sportfolio, service providers, or platform integrity.",
    ],
  },
  {
    id: "privacy",
    title: "Data and Privacy",
    body: [
      "Use of Sportfolio is also governed by the Privacy Policy, including disclosures for OAuth connections, connected-app data, action inputs and results, operational logging, retention, and revocation controls.",
    ],
  },
  {
    id: "intellectual-property",
    title: "Intellectual Property",
    body: [
      "Sportfolio's software, design, text, graphics, logos, and original content are owned by Sportfolio or its licensors and are protected by applicable intellectual-property laws.",
      "Third-party names, team marks, player information, and sports data remain the property of their respective owners and are used subject to applicable rights and licenses.",
    ],
  },
  {
    id: "no-advice",
    title: "No Financial or Betting Advice",
    body: [
      "Sportfolio gameplay analysis and AI-assisted responses are not financial, investment, legal, tax, gambling, sportsbook, or betting advice.",
      "References to virtual trades, gains, losses, balances, values, opportunities, or performance apply only inside Sportfolio's game systems.",
    ],
  },
  {
    id: "disclaimer",
    title: "Disclaimer and Limitation of Liability",
    body: [
      'Sportfolio and its integrations are provided "as is" and "as available" to the maximum extent permitted by law. We do not guarantee uninterrupted service, complete sports data, error-free AI output, successful action execution, or a particular virtual outcome.',
      "We are not responsible for perceived value or loss of virtual assets, decisions made from delayed or inaccurate data, misunderstood or incorrectly confirmed instructions, rejected or expired pending actions, or interruptions involving third-party services, subject to applicable law.",
    ],
  },
  {
    id: "termination",
    title: "Account Termination and Deletion",
    body: [
      "We may suspend or terminate accounts that violate these terms, engage in fraud or abuse, or threaten platform operations.",
      "You may request account deletion through the dedicated Delete Account page and may separately revoke connected OAuth applications without deleting your Sportfolio account.",
    ],
  },
  {
    id: "disputes",
    title: "Dispute Resolution",
    body: [
      "To the extent permitted by applicable law, disputes arising from Sportfolio will be handled under the dispute-resolution terms applicable to your account and jurisdiction. Rights that cannot legally be waived remain unaffected.",
    ],
  },
  {
    id: "changes",
    title: "Modifications",
    body: [
      "We may update these Terms when services, integrations, action capabilities, rules, security requirements, or legal obligations change.",
      "Material updates will be communicated through the service or another appropriate channel. Continued use after an effective update constitutes acceptance where permitted by law.",
    ],
  },
  {
    id: "contact",
    title: "Contact Information",
    body: [],
  },
] as const;

export default function Terms() {
  return (
    <DocumentShell
      title="Terms of Service"
      summary="Rules, limitations, and account responsibilities for Sportfolio, its gameplay systems, and connected applications."
      effectiveDate="August 6, 2026"
      sections={sections}
    >
      {sections.map((section) => (
        <DocumentSection key={section.id} id={section.id} title={section.title}>
          {section.id === "contact" ? (
            <p>
              Questions about these terms or Sportfolio's connected applications may be sent to{" "}
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
