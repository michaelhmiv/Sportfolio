import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, Clock, Zap, BarChart3, Users, CheckCircle2 } from "lucide-react";
import { SchemaOrg, schemas } from "@/components/schema-org";
import { Link } from "wouter";

const faqs = [
  {
    question: "How does trading player shares work on Sportfolio?",
    answer:
      "Players are represented as tradable shares backed by AMM pools. You can buy or sell instantly against pool liquidity with real-time quotes, and prices move as capital flows in or out of each market.",
  },
  {
    question: "What is the Scout System and how do I earn free shares?",
    answer:
      "Scouts earn shares every hour based on the Scout-Minute formula. Assign your scouts to players you want long-term exposure to, then stay active so those scouts keep producing hourly share output.",
  },
  {
    question: "How do Daily Boosts work?",
    answer:
      "Daily Boosts let you commit a single share to a started-game payout mechanic. Slot tier, share power, and any active community multiplier determine the payout after the game settles.",
  },
  {
    question: "What happens when I use a share in a boost?",
    answer:
      "The assigned share is locked and then burned by the boost flow. That means the share is removed from your available holdings for that player and cannot be used elsewhere while the boost is in play.",
  },
  {
    question: "What do leaderboards measure?",
    answer:
      "Leaderboards track account outcomes such as portfolio value, trading performance, and broader platform standing. They are public comparison tools, not a separate lineup game mode.",
  },
];

const sections = [
  {
    icon: TrendingUp,
    title: "1. Trade Player Shares",
    body: [
      "Sportfolio turns athletes into live player markets. Each player has an AMM-backed pool, so you can buy or sell instantly instead of waiting for another user to match your order.",
      "Prices rise when users buy and fall when users sell. Quote previews, slippage handling, and pool liquidity make the market mechanics transparent before you commit capital.",
    ],
  },
  {
    icon: Clock,
    title: "2. Scout Free Shares",
    body: [
      "Scouting is the primary passive accumulation system. Assign scouts to players you want exposure to and the platform distributes shares hourly based on time-weighted Scout-Minutes.",
      "Premium users can run more scouts at once, but the core mechanic is the same: sustained attention to a player creates a larger share of that player's hourly output.",
    ],
  },
  {
    icon: Zap,
    title: "3. Use Daily Boosts",
    body: [
      "Daily Boosts are the short-horizon action layer. You assign one eligible share to a boost slot and the system records that share's power for settlement.",
      "When the underlying game starts, the share enters the boost lifecycle. After the game settles, payouts depend on slot tier, the share's power level, and any community multiplier affecting that boost.",
    ],
  },
  {
    icon: BarChart3,
    title: "4. Build a Better Strategy",
    body: [
      "Strong play comes from combining market reads with sports knowledge. Some players are good long-term holds, some are better short-term boosts, and some are useful only as liquidity or momentum plays.",
      "Use player stats, recent form, schedule context, and market pricing together. The best decisions usually come from understanding when market value and game-day upside diverge.",
    ],
  },
  {
    icon: Users,
    title: "5. Track Yourself on Leaderboards",
    body: [
      "Leaderboards are the public comparison layer. They highlight top portfolios, strong traders, and users who are outperforming the broader field.",
      "Use them as feedback. If your strategy is working, the leaderboards should reflect that over time even when individual boosts or trades vary day to day.",
    ],
  },
];

export default function HowItWorks() {
  return (
    <div className="terminal-page">
      <SchemaOrg schema={schemas.faqPage(faqs)} />
      <div className="mx-auto max-w-4xl p-6 md:p-12">
        <div className="terminal-shell mb-8 p-5 md:p-6">
          <div className="terminal-strip">System Overview</div>
          <h1
            className="terminal-heading mt-4 text-3xl md:text-4xl"
            data-testid="heading-how-it-works"
          >
            How Sportfolio Works
          </h1>
          <p className="mt-3 text-sm text-muted-foreground md:text-base">
            Learn how trading, scouting, boosts, and leaderboards fit together.
          </p>
        </div>

        <Card variant="terminal" className="mb-8">
          <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="terminal-label">Reference Docs</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The Sportfolio wiki is live for deeper gameplay guides, FAQ coverage, and changelog
                entries.
              </p>
            </div>
            <Link href="/wiki">
              <Button variant="terminalOutline" data-testid="button-open-wiki">
                Open Wiki
              </Button>
            </Link>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {sections.map(({ icon: Icon, title, body }) => (
            <Card key={title} variant="terminal">
              <CardHeader>
                <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
                  <Icon className="h-5 w-5 text-primary" />
                  {title}
                </CardTitle>
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
              <CardTitle className="terminal-heading flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                Getting Started
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">Use this quick path to start cleanly:</p>
              <ol className="space-y-2">
                <li className="terminal-shell px-3 py-2 text-sm text-muted-foreground">
                  <span className="terminal-value text-xs">1.</span> Create an account and review
                  the live player pools.
                </li>
                <li className="terminal-shell px-3 py-2 text-sm text-muted-foreground">
                  <span className="terminal-value text-xs">2.</span> Buy shares in players you want
                  market exposure to.
                </li>
                <li className="terminal-shell px-3 py-2 text-sm text-muted-foreground">
                  <span className="terminal-value text-xs">3.</span> Assign scouts to build
                  recurring share flow.
                </li>
                <li className="terminal-shell px-3 py-2 text-sm text-muted-foreground">
                  <span className="terminal-value text-xs">4.</span> Use boosts selectively and
                  track how your portfolio evolves.
                </li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
