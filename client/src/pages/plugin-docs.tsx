import { CheckCircle2, ExternalLink, LockKeyhole, MessageSquare, ShieldCheck } from "lucide-react";
import { EditorialSection, PageHero, SurfaceLayout } from "@/components/surface-layout";
import { Button } from "@/components/ui/button";

const capabilities = [
  "Search Sportfolio documentation and supported public player, schedule, and performance information.",
  "Review an authorized account's virtual portfolio, balance, holdings, trades, boosts, scouts, watchlists, collections, milestones, news, liquidity, schedules, and profile state.",
  "Stage supported virtual share purchases and sales, scouting, share stacking, boosts, community boosts, and liquidity changes through Sportfolio's preview workflow.",
  "Confirm or cancel the exact staged action after reviewing virtual cost, holdings impact, balance impact, and warnings.",
  "Perform supported lower-risk account changes, such as watchlist or schedule management, after a clear request.",
] as const;

export default function PluginDocsPage() {
  return (
    <SurfaceLayout kind="public">
      <PageHero
        eyebrow="Connected application"
        title="Sportfolio for ChatGPT and Codex"
        description="Research Sportfolio data and manage supported virtual gameplay through an authorized account connection with explicit previews for consequential actions."
        icon={<MessageSquare className="h-4 w-4" aria-hidden="true" />}
        compact
        actions={
          <Button asChild variant="outline">
            <a href="/plugin-support/">Connection support</a>
          </Button>
        }
      />

      <EditorialSection title="Supported capabilities">
        <div className="grid gap-4 md:grid-cols-2">
          {capabilities.map((item) => (
            <div
              key={item}
              className="flex gap-3 rounded-panel border border-border-subtle bg-surface p-5"
            >
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
              <p className="leading-6 text-content-muted">{item}</p>
            </div>
          ))}
        </div>
      </EditorialSection>

      <EditorialSection title="Preview before execution" className="bg-surface">
        <div className="max-w-3xl space-y-4 leading-7 text-content-muted">
          <p>
            Market trades, scouting, share stacking, daily boosts, community boosts, and liquidity
            operations use Sportfolio's staged-action system. The connected app first creates a
            current preview and pending gameplay transaction.
          </p>
          <p>
            Review the displayed player, quantity, virtual cost, expected balance or holdings
            effect, and warnings. The action is finalized only after explicit confirmation of the
            same pending bundle. You may cancel a pending action instead.
          </p>
          <p>
            Some lower-risk account changes are immediate. The connected app should perform those
            changes only when the request clearly authorizes the exact operation.
          </p>
        </div>
      </EditorialSection>

      <EditorialSection title="Authentication and data boundaries">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="rounded-panel border border-border-subtle bg-surface p-5">
            <LockKeyhole className="h-5 w-5 text-brand" aria-hidden="true" />
            <h3 className="mt-4 font-bold text-content-strong">OAuth authorization</h3>
            <p className="mt-2 text-sm leading-6 text-content-muted">
              Public documentation and supported public sports information may not require account
              access. Personalized information and all account writes require an approved OAuth
              connection.
            </p>
          </div>
          <div className="rounded-panel border border-border-subtle bg-surface p-5">
            <ShieldCheck className="h-5 w-5 text-brand" aria-hidden="true" />
            <h3 className="mt-4 font-bold text-content-strong">Restricted information</h3>
            <p className="mt-2 text-sm leading-6 text-content-muted">
              Do not paste passwords, sign-in links, provider keys, access tokens, refresh tokens,
              MFA codes, or one-time authentication codes into ordinary conversation.
            </p>
          </div>
        </div>
        <a
          className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
          href="/oauth/connected-apps/"
        >
          Manage connected applications <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      </EditorialSection>

      <EditorialSection title="Virtual-only values" className="bg-surface">
        <p className="max-w-3xl leading-7 text-content-muted">
          Sportfolio shares, balances, position values, gains, losses, trades, and payouts are
          virtual game units. They are not securities, money, wagers, prizes, or withdrawable
          assets. Sportfolio does not offer real-money betting, gambling, or cash-out functionality.
        </p>
      </EditorialSection>
    </SurfaceLayout>
  );
}
