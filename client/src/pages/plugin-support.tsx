import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const sections = [
  {
    title: "Connect Sportfolio",
    items: [
      "Open the Sportfolio app in ChatGPT or Codex and choose the account-linking option when prompted.",
      "Sign in on Sportfolio's website, review the requesting application and permissions, then choose Allow access.",
      "Sportfolio never requires you to paste an API key, password, provider key, access token, refresh token, MFA code, or SMS code into ChatGPT.",
    ],
  },
  {
    title: "Market and Gameplay Actions",
    items: [
      "Virtual trades, scouting, share stacking, boosts, community boosts, and liquidity changes are staged before execution.",
      "Review the exact player, quantity, virtual cost, balance or holdings impact, and warnings shown in the preview.",
      "Confirm only the pending action you reviewed. You may cancel it instead. A staged preview is not a completed action.",
      "Immediate account writes such as watchlist or schedule changes should run only after a clear request for that exact change.",
    ],
  },
  {
    title: "Revoke Access",
    items: [
      "Open Sportfolio's Connected Applications page while signed in.",
      "Select Disconnect for the ChatGPT or Codex client you no longer authorize.",
      "Revocation invalidates the connection's refresh access. You can reconnect later through the normal OAuth flow.",
    ],
  },
  {
    title: "Scope and Limitations",
    items: [
      "The app exposes the same supported public MCP capabilities used by Sportfolio, including authenticated reads and writes.",
      "Admin, internal, debug, raw database, mobile-store billing, and unsupported provider-management controls remain unavailable.",
      "Sportfolio cannot place real-money bets, create cash prizes, cash out virtual values, or provide securities transactions.",
      "Sports schedules, statistics, rosters, injuries, and game statuses may be delayed or corrected by upstream data sources.",
    ],
  },
  {
    title: "Troubleshooting",
    items: [
      "If account linking does not appear, disconnect the existing Sportfolio grant and start the connection again.",
      "If authorization expires, return to ChatGPT or Codex and restart the connection flow rather than reusing an old consent URL.",
      "If a connected tool still requests authentication, confirm that you approved the same Sportfolio account you are trying to use.",
      "If an action remains pending, ask ChatGPT to show the pending action and either confirm or cancel that exact bundle.",
      "For inaccurate gameplay data or actions, verify the current state in Sportfolio and include the affected player, sport, date, and tool request when contacting support.",
    ],
  },
];

export default function PluginSupportPage() {
  return (
    <main className="terminal-page min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="terminal-shell p-5 sm:p-7">
          <div className="terminal-strip">Plugin Support</div>
          <h1 className="terminal-heading mt-4 text-3xl">Sportfolio for ChatGPT and Codex</h1>
          <p className="mt-3 text-muted-foreground">
            Connection, action confirmation, revocation, privacy, and troubleshooting information for the Sportfolio Companion app.
          </p>
        </header>

        {sections.map((section) => (
          <Card key={section.title} variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading text-base">{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 text-muted-foreground">
                {section.items.map((item, index) => (
                  <li key={item}>
                    {index + 1}. {item}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ))}

        <Card variant="terminal">
          <CardHeader>
            <CardTitle className="terminal-heading text-base">Links and Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-muted-foreground">
            <p>
              <a className="text-primary underline" href="/oauth/connected-apps/">
                Manage connected applications
              </a>
            </p>
            <p>
              <a className="text-primary underline" href="/plugin/">
                Read plugin documentation
              </a>
            </p>
            <p>
              <a className="text-primary underline" href="/privacy">
                Privacy Policy
              </a>{" "}
              ·{" "}
              <a className="text-primary underline" href="/terms">
                Terms of Service
              </a>
            </p>
            <p>
              Email{" "}
              <a className="text-primary underline" href="mailto:sportfolioholdings@gmail.com">
                sportfolioholdings@gmail.com
              </a>{" "}
              for support.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
