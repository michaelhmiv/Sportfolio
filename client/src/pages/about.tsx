import {
  BarChart3,
  Layers3,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Link } from "wouter";
import { EditorialSection, PageHero, SurfaceLayout } from "@/components/surface-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const principles = [
  {
    icon: TrendingUp,
    title: "Markets that react",
    description:
      "Player prices move through virtual market activity, liquidity, and changing demand rather than a static roster score.",
  },
  {
    icon: Search,
    title: "Knowledge creates an edge",
    description:
      "Schedules, form, role, matchups, injuries, and market context all inform better portfolio decisions.",
  },
  {
    icon: Zap,
    title: "Long-term and game-day play",
    description:
      "Hold positions over time, earn shares through scouting, and use boosts when short-horizon opportunity appears.",
  },
  {
    icon: ShieldCheck,
    title: "Virtual by design",
    description:
      "Sportfolio uses virtual balances and shares. It does not offer cash-out, real-money wagering, or securities trading.",
  },
] as const;

export default function About() {
  return (
    <SurfaceLayout kind="public">
      <PageHero
        eyebrow="About Sportfolio"
        title="A sports portfolio game built around live player markets."
        description="Sportfolio combines sports research, market mechanics, scouting, collections, and game-day decisions into one multi-sport experience."
        icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
        actions={
          <>
            <Button asChild size="lg">
              <Link href="/pools">Explore player pools</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/how-it-works">How it works</Link>
            </Button>
          </>
        }
      />

      <EditorialSection
        title="The product idea"
        description="Traditional fantasy formats reset around lineups and isolated contests. Sportfolio gives player exposure continuity: positions, prices, scouting, collections, and performance history persist as your strategy evolves."
      >
        <div className="grid gap-5 md:grid-cols-3">
          {[
            {
              icon: Radio,
              label: "Follow",
              body: "Track live market and game context across supported sports.",
            },
            {
              icon: BarChart3,
              label: "Position",
              body: "Build a virtual portfolio around players and strategies you understand.",
            },
            {
              icon: Layers3,
              label: "Develop",
              body: "Scout, stack, collect, and boost shares as your account grows.",
            },
          ].map(({ icon: Icon, label, body }) => (
            <Card key={label} variant="interactive">
              <CardContent className="p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-panel bg-brand-subtle text-brand">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="mt-5 text-lg font-bold text-content-strong">{label}</h3>
                <p className="mt-2 leading-6 text-content-muted">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </EditorialSection>

      <EditorialSection title="What guides the experience">
        <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {principles.map(({ icon: Icon, title, description }) => (
            <div key={title} className="flex gap-4">
              <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-surface-raised text-brand">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <h3 className="font-bold text-content-strong">{title}</h3>
                <p className="mt-2 leading-6 text-content-muted">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </EditorialSection>

      <EditorialSection
        className="bg-surface"
        title="Built as a living sports platform"
        description="Sportfolio is designed to add sports and new strategy layers without forcing every experience into one rigid fantasy format."
      >
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/wiki">Read the handbook</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/contact">Contact Sportfolio</Link>
          </Button>
        </div>
      </EditorialSection>
    </SurfaceLayout>
  );
}
