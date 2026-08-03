import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const capabilities = [
  "Search Sportfolio documentation and public player information.",
  "Review supported games and recent player performance.",
  "After OAuth connection, review your virtual portfolio, balance, watchlists, boosts, collections, milestones, digest, and personalized game insights.",
  "Generate read-only setup reviews and candidate ideas for boosts and scouting.",
];

export default function PluginDocsPage() {
  return (
    <main className="terminal-page min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="terminal-shell p-5 sm:p-7">
          <div className="terminal-strip">Plugin Documentation</div>
          <h1 className="terminal-heading mt-4 text-3xl">Sportfolio Companion</h1>
          <p className="mt-3 text-muted-foreground">
            A read-only ChatGPT and Codex companion for Sportfolio's virtual fantasy-sports portfolio game.
          </p>
        </header>

        <Card variant="terminal">
          <CardHeader><CardTitle className="terminal-heading text-base">Capabilities</CardTitle></CardHeader>
          <CardContent><ul className="space-y-3 text-muted-foreground">{capabilities.map((item) => <li key={item}>• {item}</li>)}</ul></CardContent>
        </Card>

        <Card variant="terminal">
          <CardHeader><CardTitle className="terminal-heading text-base">Read-only by design</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-muted-foreground">
            <p>The marketplace version cannot execute virtual trades, assign boosts, scout players, edit watchlists, change account settings, manage credentials, or purchase premium access.</p>
            <p>Use the Sportfolio website or app for changes. ChatGPT should never claim that an unsupported action succeeded.</p>
          </CardContent>
        </Card>

        <Card variant="terminal">
          <CardHeader><CardTitle className="terminal-heading text-base">Authentication and data</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-muted-foreground">
            <p>Public documentation, player, and schedule tools do not require account access. Personalized tools use OAuth 2.1 and require your explicit approval.</p>
            <p>Never paste a Sportfolio API key, password, access token, refresh token, MFA code, OTP, or SMS verification code into ChatGPT.</p>
            <p>You may revoke OAuth access from the <a className="text-primary underline" href="/oauth/connected-apps/">Connected Applications page</a>.</p>
          </CardContent>
        </Card>

        <Card variant="terminal">
          <CardHeader><CardTitle className="terminal-heading text-base">Virtual-only game values</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-muted-foreground">
            <p>Sportfolio shares, balances, position values, gains, losses, and payouts are virtual game units. They are not securities, money, wagers, prizes, or withdrawable assets.</p>
            <p>Sportfolio does not offer real-money betting, gambling, or cash-out functionality.</p>
          </CardContent>
        </Card>

        <p className="text-sm text-muted-foreground">
          Need help? Visit <a className="text-primary underline" href="/plugin-support/">Plugin Support</a> or email <a className="text-primary underline" href="mailto:sportfolioholdings@gmail.com">sportfolioholdings@gmail.com</a>.
        </p>
      </div>
    </main>
  );
}
