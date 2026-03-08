import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Trophy, Users, Zap } from "lucide-react";

export default function About() {
  return (
    <div className="terminal-page">
      <div className="mx-auto max-w-4xl p-6 md:p-12">
        <div className="terminal-shell mb-8 p-5 md:p-6">
          <div className="terminal-strip">Company Brief</div>
          <h1 className="terminal-heading mt-4 text-3xl md:text-4xl" data-testid="heading-about">
            About Sportfolio
          </h1>
          <p className="mt-3 text-sm text-muted-foreground md:text-base">
            Where fantasy sports meets stock market trading
          </p>
        </div>

        <div className="space-y-6">
          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
                <Zap className="h-5 w-5 text-primary" />
                Our Mission
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Sportfolio revolutionizes fantasy sports by combining the excitement of NBA player
                performance with the dynamics of stock market trading. We created a platform where
                sports knowledge meets strategic investing, giving fans a new way to engage with
                basketball beyond traditional fantasy leagues.
              </p>
            </CardContent>
          </Card>

          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
                <TrendingUp className="h-5 w-5 text-primary" />
                How It Works
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                On Sportfolio, NBA players are represented as tradable shares with prices that
                fluctuate based on market activity. You can buy and sell player shares, build a
                diversified portfolio, and watch your portfolio value change as the market moves.
              </p>
              <p className="text-muted-foreground">
                Beyond trading, Sportfolio layers in scouting, stacked shares, daily boosts, and
                public leaderboards so your edge can come from both long-term market positioning and
                short-horizon game-day decisions.
              </p>
            </CardContent>
          </Card>

          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
                <Trophy className="h-5 w-5 text-primary" />
                Key Features
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                <li className="terminal-shell px-3 py-2">
                  <p className="terminal-label">Player Share Trading</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Buy and sell NBA player shares with real-time market pricing.
                  </p>
                </li>
                <li className="terminal-shell px-3 py-2">
                  <p className="terminal-label">Scout Rewards</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Assign scouts to players to earn free shares on an hourly cadence.
                  </p>
                </li>
                <li className="terminal-shell px-3 py-2">
                  <p className="terminal-label">Daily Boosts</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Commit eligible shares to slot-based payouts tied to real game outcomes.
                  </p>
                </li>
                <li className="terminal-shell px-3 py-2">
                  <p className="terminal-label">Live Leaderboards</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Track your performance against other users across multiple categories.
                  </p>
                </li>
                <li className="terminal-shell px-3 py-2">
                  <p className="terminal-label">Real NBA Data</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Player performance and schedule data power the live market experience.
                  </p>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card variant="terminal">
            <CardHeader>
              <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
                <Users className="h-5 w-5 text-primary" />
                Join Our Community
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Sportfolio is built by sports fans, for sports fans. Join our growing community on
                Discord to connect with other users, share trading strategies, discuss NBA matchups,
                and stay updated on platform developments.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
