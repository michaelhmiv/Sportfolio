import { AlertTriangle, CheckCircle2, Link2, LockKeyhole, RotateCcw, ShieldCheck } from "lucide-react";
import { EditorialSection, PageHero, SurfaceLayout } from "@/components/surface-layout";
import { Button } from "@/components/ui/button";
import { SPORTFOLIO_SUPPORT_EMAIL } from "@/lib/community-links";

const sections = [
  {
    icon: Link2,
    title: "Connect Sportfolio",
    items: [
      "Open the Sportfolio app in ChatGPT or Codex and choose the account-linking option when prompted.",
      "Sign in on Sportfolio's website, review the requesting application and permissions, then choose Allow access.",
      "Return to ChatGPT or Codex after the authorization flow completes.",
    ],
  },
  {
    icon: CheckCircle2,
    title: "Review consequential actions",
    items: [
      "Virtual trades, scouting, share stacking, boosts, community boosts, and liquidity changes are staged before execution.",
      "Review the exact player, quantity, virtual cost, balance or holdings impact, and warnings shown in the preview.",
      "Confirm only the pending action you reviewed. A staged preview is not a completed action.",
    ],
  },
  {
    icon: ShieldCheck,
    title: "Revoke access",
    items: [
      "Open Sportfolio's Connected Applications page while signed in.",
      "Choose Disconnect for the ChatGPT or Codex client you no longer authorize.",
      "You can reconnect later through the normal OAuth flow.",
    ],
  },
  {
    icon: RotateCcw,
    title: "Troubleshoot the connection",
    items: [
      "If linking does not appear, disconnect the existing Sportfolio grant and start the connection again.",
      "If authorization expires, restart the connection rather than reusing an old consent URL.",
      "If a tool still requests authentication, verify that you approved the same Sportfolio account you are trying to use.",
      "If an action remains pending, ask to show the pending action and then confirm or cancel that exact bundle.",
    ],
  },
] as const;

export default function PluginSupportPage() {
  return (
    <SurfaceLayout kind="public">
      <PageHero
        eyebrow="Connected-app support"
        title="Connect, confirm, revoke, and recover safely."
        description="Use this guide for Sportfolio account connections in ChatGPT and Codex, including staged actions and common authorization failures."
        icon={<LockKeyhole className="h-4 w-4" aria-hidden="true" />}
        compact
      />

      <EditorialSection title="Connection workflow">
        <div className="grid gap-5 md:grid-cols-2">
          {sections.map(({ icon: Icon, title, items }) => (
            <section key={title} className="rounded-panel border border-border-subtle bg-surface p-5 sm:p-6">
              <Icon className="h-5 w-5 text-brand" aria-hidden="true" />
              <h2 className="mt-4 text-lg font-bold text-content-strong">{title}</h2>
              <ol className="mt-4 space-y-3">
                {items.map((item, index) => (
                  <li key={item} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2 text-sm leading-6 text-content-muted">
                    <span className="font-mono text-xs font-bold text-brand">{index + 1}</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </EditorialSection>

      <EditorialSection title="Security boundary" className="bg-surface">
        <div className="flex max-w-3xl gap-4 rounded-panel border border-status-warning/30 bg-status-warning-subtle p-5">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-status-warning" aria-hidden="true" />
          <div>
            <h3 className="font-bold text-content-strong">Never paste authentication secrets into conversation.</h3>
            <p className="mt-2 leading-7 text-content-muted">Sportfolio does not require API keys, passwords, provider keys, access tokens, refresh tokens, MFA codes, or one-time sign-in codes in ChatGPT or Codex. Complete authentication only through the Sportfolio sign-in and consent pages.</p>
          </div>
        </div>
      </EditorialSection>

      <EditorialSection title="Scope and limitations">
        <ul className="max-w-3xl space-y-3 text-content-muted">
          <li>Supported public, authenticated read, and approved write capabilities are exposed through the connected app.</li>
          <li>Admin, internal, debug, raw database, mobile-store billing, credential-management, and private provider controls remain unavailable.</li>
          <li>Sportfolio cannot place real-money bets, create cash prizes, cash out virtual values, or provide securities transactions.</li>
          <li>Sports schedules, statistics, rosters, injuries, and game statuses may be delayed or corrected by upstream data sources.</li>
        </ul>
        <div className="mt-7 flex flex-wrap gap-3">
          <Button asChild><a href="/oauth/connected-apps/">Manage connected applications</a></Button>
          <Button asChild variant="outline"><a href="/plugin/">Read app documentation</a></Button>
          <Button asChild variant="outline"><a href={`mailto:${SPORTFOLIO_SUPPORT_EMAIL}`}>Email support</a></Button>
        </div>
      </EditorialSection>
    </SurfaceLayout>
  );
}
