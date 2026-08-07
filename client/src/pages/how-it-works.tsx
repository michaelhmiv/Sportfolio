import {
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  Clock,
  Search,
  ShieldCheck,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { Link } from "wouter";
import { SchemaOrg, schemas } from "@/components/schema-org";
import { EditorialSection, PageHero, SurfaceLayout } from "@/components/surface-layout";
import { Button } from "@/components/ui/button";

const faqs = [
  {
    question: "How does trading player shares work on Sportfolio?",
    answer:
      "Players are represented as virtual shares backed by AMM pools. Once a pool is initialized, users can buy or sell against its liquidity and the quoted price changes as virtual capital moves in or out.",
  },
  {
    question: "What is scouting?",
    answer:
      "Scouting is Sportfolio's recurring share-earning system. Assign scouts to players and remain active to accumulate shares over time through the current scouting rules.",
  },
  {
    question: "How do boosts work?",
    answer:
      "Boosts are the game-day action layer. An eligible share enters a boost slot and its virtual outcome is settled from the applicable rules, multiplier, and real-game performance context.",
  },
  {
    question: "Can Sportfolio balances or shares be withdrawn for cash?",
    answer:
      "No. Sportfolio balances, shares, gains, losses, and payouts are virtual gameplay units with no cash-out or real-money wagering functionality.",
  },
];

const steps = [
  {
    icon: Search,
    number: "01",
    title: "Read the field",
    description:
      "Use schedules, recent form, player roles, injuries, matchup context, and market activity to identify where your sports view differs from the current price.",
  },
  {
    icon: TrendingUp,
    number: "02",
    title: "Trade a player market",
    description:
      "Preview a virtual buy or sell against the player's liquidity pool. Review price impact, quantity, and account effect before submitting the trade.",
  },
  {
    icon: BriefcaseBusiness,
    number: "03",
    title: "Build the portfolio",
    description:
      "Combine positions across players and sports. Track value, exposure, and performance instead of treating every decision as an isolated lineup choice.",
  },
  {
    icon: Clock,
    number: "04",
    title: "Scout for continued exposure",
    description:
      "Assign scouts to players you want to accumulate over time. Scouting adds a long-horizon resource layer beyond direct market purchases.",
  },
  {
    icon: Zap,
    number: "05",
    title: "Act on game day",
    description:
      "Use eligible shares in daily boosts when a real-game opportunity fits your strategy. Boosts complement the portfolio; they do not replace it.",
  },
  {
    icon: BarChart3,
    number: "06",
    title: "Review and adapt",
    description:
      "Follow market movement, portfolio results, collections, and leaderboards to understand what is working and where your assumptions need to change.",
  },
] as const;

export default function HowItWorks() {
  return (
    <SurfaceLayout kind="public">
      <SchemaOrg schema={schemas.faqPage(faqs)} />
      <PageHero
        eyebrow="How Sportfolio works"
        title="Research players. Build positions. Make game-day decisions."
        description="Sportfolio connects persistent player markets with scouting, boosts, collections, and public competition. Each system supports the same portfolio rather than creating a separate mini-game."
        icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />}
        actions={
          <>
            <Button asChild size="lg">
              <Link href="/pools">Open player pools</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/wiki">Read detailed rules</Link>
            </Button>
          </>
        }
      />

      <EditorialSection
        title="One continuous strategy loop"
        description="The interface is organized around the decision you are making now while preserving the history and positions created by earlier decisions."
      >
        <div className="divide-y divide-border-subtle rounded-panel border border-border-subtle bg-surface shadow-low">
          {steps.map(({ icon: Icon, number, title, description }) => (
            <div
              key={number}
              className="grid gap-4 px-5 py-6 sm:grid-cols-[72px_48px_minmax(0,1fr)] sm:items-start sm:px-7"
            >
              <span className="font-mono text-sm font-bold text-brand">{number}</span>
              <div className="flex h-10 w-10 items-center justify-center rounded-control bg-brand-subtle text-brand">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-content-strong">{title}</h3>
                <p className="mt-2 max-w-3xl leading-7 text-content-muted">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </EditorialSection>

      <EditorialSection title="What the major surfaces are for" className="bg-surface">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: TrendingUp,
              title: "Player Pools",
              body: "Discover, compare, filter, and trade active player markets.",
            },
            {
              icon: BriefcaseBusiness,
              title: "Portfolio",
              body: "Review holdings, exposure, value, and account-level performance.",
            },
            {
              icon: Zap,
              title: "Boosts",
              body: "Use eligible shares in short-horizon game-day outcomes.",
            },
            {
              icon: Users,
              title: "Collections",
              body: "Track durable achievements and themed progress across sports.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-panel border border-border-subtle bg-canvas p-5">
              <Icon className="h-5 w-5 text-brand" aria-hidden="true" />
              <h3 className="mt-4 font-bold text-content-strong">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-content-muted">{body}</p>
            </div>
          ))}
        </div>
      </EditorialSection>

      <EditorialSection title="Important boundary">
        <div className="flex max-w-3xl gap-4 rounded-panel border border-brand/25 bg-brand-subtle p-5">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-brand" aria-hidden="true" />
          <div>
            <h3 className="font-bold text-content-strong">Sportfolio is virtual gameplay.</h3>
            <p className="mt-2 leading-7 text-content-muted">
              Virtual balances, shares, gains, losses, and payouts are not money, securities,
              wagers, or withdrawable assets. The platform does not provide real-money betting or
              cash-out.
            </p>
          </div>
        </div>
        <Button asChild variant="outline" className="mt-6 gap-2">
          <Link href="/wiki">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            Open the handbook
          </Link>
        </Button>
      </EditorialSection>
    </SurfaceLayout>
  );
}
