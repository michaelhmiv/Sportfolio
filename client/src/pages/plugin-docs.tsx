import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const capabilities = [
  "Search Sportfolio documentation and public player, schedule, and performance information.",
  "Review your connected virtual portfolio, balance, holdings, trades, boosts, scouts, watchlists, collections, milestones, news, liquidity, schedules, and account state.",
  "Stage virtual share purchases and sales, scouting, share stacking, boosts, community boosts, and liquidity changes using Sportfolio's existing preview workflow.",
  "Confirm or cancel the exact staged action after reviewing its virtual cost, holdings impact, balance impact, and warnings.",
  "Create and manage supported watchlists, schedules, profile settings, milestones, news state, agent settings, and agent threads.",
];

export default function PluginDocsPage() {
  return (
    <main className="terminal-page min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="terminal-shell p-5 sm:p-7">
          <div className="terminal-strip">Plugin Documentation</div>
          <h1 className="terminal-heading mt-4 text-3xl">Sportfolio Companion</h1>
          <p className="mt-3 text-muted-foreground">
            A ChatGPT and Codex companion for researching and managing Sportfolio's virtual fantasy-sports portfolio game.
          </p>
        </header>

        <Card variant="terminal">
          <CardHeader>
            <CardTitle className="terminal-heading text-base">Capabilities</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-muted-foreground">
              {capabilities.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card variant="terminal">
          <CardHeader>
            <CardTitle className="terminal-heading text-base">Action previews and confirmation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-muted-foreground">
            <p>
              Market trades, scouting, share stacking, daily boosts, community boosts, and liquidity operations use Sportfolio's staged-action system. ChatGPT first creates a current preview and pending action bundle.
            </p>
            <p>
              Review the displayed player, quantity, virtual cost, expected balance or holdings impact, and warnings. The action is finalized only after explicit confirmation using the same pending bundle. You can cancel a pending action instead.
            </p>
            <p>
              Some lower-risk account changes, such as watchlist or schedule management, are immediate. ChatGPT should call those tools only when your request clearly authorizes the exact change.
            </p>
          </CardContent>
        </Card>

        <Card variant="terminal">
          <CardHeader>
            <CardTitle className="terminal-heading text-base">Authentication and data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-muted-foreground">
            <p>
              Public documentation, player, and schedule tools do not require account access. Personalized information and all writes use OAuth 2.1 and require your approval.
            </p>
            <p>
              Never paste a Sportfolio API key, password, provider key, access token, refresh token, MFA code, OTP, or SMS verification code into ChatGPT.
            </p>
            <p>
              You may revoke OAuth access from the{" "}
              <a className="text-primary underline" href="/oauth/connected-apps/">
                Connected Applications page
              </a>
              .
            </p>
          </CardContent>
        </Card>

        <Card variant="terminal">
          <CardHeader>
            <CardTitle className="terminal-heading text-base">Virtual-only game values</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-muted-foreground">
            <p>
              Sportfolio shares, balances, position values, gains, losses, trades, and payouts are virtual game units. They are not securities, money, wagers, prizes, or withdrawable assets.
            </p>
            <p>Sportfolio does not offer real-money betting, gambling, or cash-out functionality.</p>
          </CardContent>
        </Card>

        <p className="text-sm text-muted-foreground">
          Need help? Visit{" "}
          <a className="text-primary underline" href="/plugin-support/">
            Plugin Support
          </a>{" "}
          or email{" "}
          <a className="text-primary underline" href="mailto:sportfolioholdings@gmail.com">
            sportfolioholdings@gmail.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}
