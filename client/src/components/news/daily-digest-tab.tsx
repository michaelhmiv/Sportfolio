import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Clock,
  DollarSign,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  Wallet,
} from "lucide-react";

import { PlayerLinkedText } from "@/components/player-linked-text";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type DigestItem = {
  label: string;
  value: string;
  change?: string;
  isPositive?: boolean;
};

export interface DigestSection {
  title: string;
  items: DigestItem[];
}

export interface DigestSummaryItem {
  label: string;
  value: string;
  change?: string;
  isPositive?: boolean;
}

export interface Digest {
  userId: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  summary: DigestSummaryItem[];
  sections: DigestSection[];
}

type DigestFocusMode = "all" | "upside" | "watchlist";

type DigestSectionView = DigestSection & {
  filteredItems: DigestItem[];
  positiveCount: number;
  negativeCount: number;
};

type SectionAccent = {
  icon: LucideIcon;
  toneClass: string;
  badgeClass: string;
  ringClass: string;
};

const defaultAccent: SectionAccent = {
  icon: BarChart3,
  toneClass: "text-slate-300",
  badgeClass: "bg-slate-500/15 text-slate-200 border-slate-400/30",
  ringClass: "from-slate-500/50 to-slate-300/20",
};

const sectionAccentMap: Record<string, SectionAccent> = {
  "Contest Results": {
    icon: Trophy,
    toneClass: "text-amber-300",
    badgeClass: "bg-amber-500/15 text-amber-200 border-amber-400/30",
    ringClass: "from-amber-500/50 to-amber-300/20",
  },
  "Portfolio Health": {
    icon: DollarSign,
    toneClass: "text-emerald-300",
    badgeClass: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
    ringClass: "from-emerald-500/50 to-emerald-300/20",
  },
  "Scout Activity": {
    icon: BarChart3,
    toneClass: "text-cyan-300",
    badgeClass: "bg-cyan-500/15 text-cyan-200 border-cyan-400/30",
    ringClass: "from-cyan-500/50 to-cyan-300/20",
  },
  "Boost Performance": {
    icon: Target,
    toneClass: "text-orange-300",
    badgeClass: "bg-orange-500/15 text-orange-200 border-orange-400/30",
    ringClass: "from-orange-500/50 to-orange-300/20",
  },
  "Earnings Breakdown": {
    icon: Wallet,
    toneClass: "text-lime-300",
    badgeClass: "bg-lime-500/15 text-lime-200 border-lime-400/30",
    ringClass: "from-lime-500/50 to-lime-300/20",
  },
  "Portfolio Attribution": {
    icon: DollarSign,
    toneClass: "text-sky-300",
    badgeClass: "bg-sky-500/15 text-sky-200 border-sky-400/30",
    ringClass: "from-sky-500/50 to-sky-300/20",
  },
  "Market Movers": {
    icon: TrendingUp,
    toneClass: "text-blue-300",
    badgeClass: "bg-blue-500/15 text-blue-200 border-blue-400/30",
    ringClass: "from-blue-500/50 to-blue-300/20",
  },
  "Vesting Activity": {
    icon: Clock,
    toneClass: "text-indigo-300",
    badgeClass: "bg-indigo-500/15 text-indigo-200 border-indigo-400/30",
    ringClass: "from-indigo-500/50 to-indigo-300/20",
  },
};

const digestFocusOptions: Array<{
  id: DigestFocusMode;
  label: string;
  description: string;
}> = [
  { id: "all", label: "Full Board", description: "Everything in your daily report" },
  { id: "upside", label: "Upside", description: "Wins and positive movement first" },
  { id: "watchlist", label: "Watchlist", description: "Risks and neutral checkpoints" },
];

function getSectionAccent(title: string): SectionAccent {
  return sectionAccentMap[title] ?? defaultAccent;
}

function matchesFocus(item: DigestItem, focus: DigestFocusMode): boolean {
  if (focus === "all") return true;
  if (focus === "upside") return item.isPositive !== false;
  return item.isPositive !== true;
}

function buildDigestSections(
  sections: DigestSection[] | undefined,
  focus: DigestFocusMode,
): DigestSectionView[] {
  if (!sections?.length) return [];

  return sections
    .map((section) => {
      const positiveCount = section.items.filter((item) => item.isPositive === true).length;
      const negativeCount = section.items.filter((item) => item.isPositive === false).length;
      const filteredItems = section.items.filter((item) => matchesFocus(item, focus));

      return {
        ...section,
        filteredItems,
        positiveCount,
        negativeCount,
      };
    })
    .filter((section) => section.filteredItems.length > 0);
}

function DigestSigninNotice() {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <BarChart3 className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
        <h3 className="mb-1 font-semibold">Sign In Required</h3>
        <p className="text-sm text-muted-foreground">
          Sign in to see your personalized daily digest.
        </p>
      </CardContent>
    </Card>
  );
}

function DigestLoadingState() {
  return (
    <div className="space-y-3">
      <Card className="overflow-hidden border-slate-300/70 bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 text-slate-50">
        <CardContent className="space-y-3 p-4">
          <Skeleton className="h-5 w-2/3 bg-slate-100/25" />
          <Skeleton className="h-4 w-1/2 bg-slate-100/25" />
          <Skeleton className="h-3 w-full bg-slate-100/20" />
        </CardContent>
      </Card>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {[...Array(3)].map((_, i) => (
          <Card key={i} className="min-w-[180px]">
            <CardContent className="space-y-3 p-4">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
      {[...Array(2)].map((_, i) => (
        <Card key={`section-${i}`}>
          <CardContent className="space-y-3 p-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DigestEmptyState() {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <BarChart3 className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
        <h3 className="mb-1 font-semibold">No Digest Available</h3>
        <p className="text-sm text-muted-foreground">
          Your personalized digest will be generated daily at 6 AM ET.
        </p>
      </CardContent>
    </Card>
  );
}

function DigestHero({
  digest,
  digestSectionsCount,
  totalVisibleDigestItems,
  digestMomentumScore,
}: {
  digest: Digest;
  digestSectionsCount: number;
  totalVisibleDigestItems: number;
  digestMomentumScore: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-3xl border border-slate-300/50 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-4 text-slate-50 shadow-lg sm:p-5"
    >
      <div className="pointer-events-none absolute -right-16 -top-12 h-40 w-40 rounded-full bg-emerald-300/15 blur-3xl" />
      <div className="pointer-events-none absolute -left-8 bottom-0 h-32 w-32 rounded-full bg-cyan-300/10 blur-2xl" />

      <div className="relative space-y-4">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200/90">
            Daily Intelligence Deck
          </p>
          <h2 className="text-xl font-semibold leading-tight sm:text-2xl">
            Explore your account from every angle
          </h2>
          <p className="text-xs text-slate-200/80">
            {digest.periodLabel} window, generated{" "}
            {formatDistanceToNow(new Date(digest.generatedAt), { addSuffix: true })}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-slate-200/20 bg-slate-50/5 px-2 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-300">Sections</p>
            <p className="text-lg font-semibold">{digestSectionsCount}</p>
          </div>
          <div className="rounded-xl border border-slate-200/20 bg-slate-50/5 px-2 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-300">Metrics</p>
            <p className="text-lg font-semibold">{totalVisibleDigestItems}</p>
          </div>
          <div className="rounded-xl border border-slate-200/20 bg-slate-50/5 px-2 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-300">Momentum</p>
            <p className="text-lg font-semibold">{digestMomentumScore}%</p>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-200/85">
            <span>Positive signal ratio</span>
            <span>{digestMomentumScore}%</span>
          </div>
          <Progress
            value={digestMomentumScore}
            className="h-2 rounded-full border-slate-300/20 bg-slate-800/80"
            indicatorClassName="bg-gradient-to-r from-emerald-400 to-cyan-400"
          />
        </div>
      </div>
    </motion.div>
  );
}

function FocusLensSelector({
  digestFocus,
  onFocusChange,
}: {
  digestFocus: DigestFocusMode;
  onFocusChange: (focus: DigestFocusMode) => void;
}) {
  return (
    <Card className="rounded-2xl border-slate-300/70">
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Focus Lens
          </p>
          <p className="text-[11px] text-muted-foreground">Tap to reshape your board</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {digestFocusOptions.map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant={digestFocus === option.id ? "default" : "outline"}
              className={cn(
                "h-auto min-h-[74px] flex-col items-start rounded-xl px-3 py-2 text-left text-xs",
                digestFocus === option.id && "bg-slate-900 text-slate-50 hover:bg-slate-800",
              )}
              onClick={() => onFocusChange(option.id)}
            >
              <span className="font-semibold leading-tight">{option.label}</span>
              <span className="mt-1 text-[10px] leading-snug opacity-80">{option.description}</span>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SnapshotCards({ digestSummary }: { digestSummary: DigestSummaryItem[] }) {
  if (!digestSummary.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Snapshot Cards
        </p>
        <p className="text-[11px] text-muted-foreground">Swipe to compare metrics</p>
      </div>
      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
        {digestSummary.map((item, index) => (
          <motion.div
            key={`${item.label}-${index}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04 }}
            className="min-w-[180px] snap-start"
          >
            <Card className="h-full rounded-2xl border-slate-300/70">
              <CardContent className="space-y-2 p-4">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {item.label}
                </div>
                <div className="text-2xl font-semibold leading-none tracking-tight">
                  {item.value}
                </div>
                {item.change && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      "inline-flex w-fit border px-2 py-0.5 text-[11px]",
                      item.isPositive
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                        : "border-rose-500/30 bg-rose-500/10 text-rose-600",
                    )}
                  >
                    {item.isPositive ? (
                      <TrendingUp className="mr-1 h-3 w-3" />
                    ) : (
                      <TrendingDown className="mr-1 h-3 w-3" />
                    )}
                    {item.change}
                  </Badge>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function SectionExplorer({
  digestSections,
  activeDigestSection,
  onSectionSelect,
}: {
  digestSections: DigestSectionView[];
  activeDigestSection: string | null;
  onSectionSelect: (sectionTitle: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Section Explorer
        </p>
        <p className="text-[11px] text-muted-foreground">Pick a lane, then drill down</p>
      </div>
      <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2">
        {digestSections.map((section) => {
          const accent = getSectionAccent(section.title);
          const Icon = accent.icon;
          const selected = activeDigestSection === section.title;

          return (
            <button
              key={`chip-${section.title}`}
              type="button"
              onClick={() => onSectionSelect(section.title)}
              className={cn(
                "min-w-[170px] snap-start rounded-2xl border px-3 py-2 text-left transition-all",
                selected
                  ? "border-slate-900 bg-slate-900 text-slate-50 shadow-md"
                  : "border-slate-300/70 bg-card hover:border-slate-400",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <p className="text-xs font-semibold leading-tight">{section.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {section.filteredItems.length} metrics
                  </p>
                </div>
                <Icon className={cn("h-4 w-4", selected ? "text-cyan-300" : accent.toneClass)} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SectionSpotlight({ section }: { section: DigestSectionView }) {
  const accent = getSectionAccent(section.title);
  const Icon = accent.icon;

  return (
    <motion.div
      key={`spotlight-${section.title}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="relative overflow-hidden rounded-3xl border-slate-300/70">
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r",
            accent.ringClass,
          )}
        />
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className={cn("h-4 w-4", accent.toneClass)} />
            {section.title}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Top signals for this lens. Use the Deep Dive below for every metric.
          </p>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {section.filteredItems.slice(0, 4).map((item, index) => (
            <div
              key={`${section.title}-${index}`}
              className="rounded-xl border border-slate-300/60 bg-muted/30 p-3"
            >
              <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                <PlayerLinkedText
                  text={item.label}
                  className="min-w-0 text-sm font-semibold leading-snug break-words"
                />
                <span className="shrink-0 text-right text-sm font-semibold leading-tight">
                  {item.value}
                </span>
              </div>
              {item.change && (
                <Badge
                  variant="secondary"
                  className={cn(
                    "border text-[11px]",
                    item.isPositive
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                      : "border-rose-500/30 bg-rose-500/10 text-rose-600",
                  )}
                >
                  {item.isPositive ? (
                    <TrendingUp className="mr-1 h-3 w-3" />
                  ) : (
                    <TrendingDown className="mr-1 h-3 w-3" />
                  )}
                  {item.change}
                </Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function DigestDeepDive({ digestSections }: { digestSections: DigestSectionView[] }) {
  return (
    <Card className="rounded-2xl border-slate-300/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Deep Dive</CardTitle>
        <p className="text-xs text-muted-foreground">
          Expand each section to study every metric in your report.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <Accordion type="multiple" className="space-y-1">
          {digestSections.map((section, sIndex) => {
            const accent = getSectionAccent(section.title);
            const Icon = accent.icon;

            return (
              <AccordionItem
                key={`accordion-${section.title}`}
                value={section.title}
                className="rounded-xl border border-slate-300/60 px-3"
              >
                <AccordionTrigger className="gap-3 py-3 hover:no-underline">
                  <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <Icon className={cn("h-4 w-4 shrink-0", accent.toneClass)} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{section.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {section.filteredItems.length} metrics
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant="secondary"
                    className={cn("shrink-0 border text-[11px]", accent.badgeClass)}
                  >
                    {section.positiveCount} up / {section.negativeCount} down
                  </Badge>
                </AccordionTrigger>
                <AccordionContent className="space-y-2 pb-3">
                  {section.filteredItems.map((item, iIndex) => (
                    <motion.div
                      key={`item-${section.title}-${iIndex}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: sIndex * 0.03 + iIndex * 0.02 }}
                      className="rounded-lg border border-slate-300/50 bg-card px-3 py-2"
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                        <PlayerLinkedText
                          text={item.label}
                          className="min-w-0 text-sm font-medium leading-snug break-words"
                        />
                        <span className="shrink-0 text-right text-sm font-semibold leading-tight">
                          {item.value}
                        </span>
                      </div>
                      {item.change && (
                        <Badge
                          variant="secondary"
                          className={cn(
                            "mt-2 border text-[11px]",
                            item.isPositive
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                              : "border-rose-500/30 bg-rose-500/10 text-rose-600",
                          )}
                        >
                          {item.isPositive ? (
                            <TrendingUp className="mr-1 h-3 w-3" />
                          ) : (
                            <TrendingDown className="mr-1 h-3 w-3" />
                          )}
                          {item.change}
                        </Badge>
                      )}
                    </motion.div>
                  ))}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
}

interface DailyDigestTabProps {
  isAuthenticated: boolean;
  digestLoading: boolean;
  digest?: Digest;
}

export function DailyDigestTab({ isAuthenticated, digestLoading, digest }: DailyDigestTabProps) {
  const [digestFocus, setDigestFocus] = useState<DigestFocusMode>("all");
  const [activeDigestSection, setActiveDigestSection] = useState<string | null>(null);

  const digestSections = useMemo(
    () => buildDigestSections(digest?.sections, digestFocus),
    [digest?.sections, digestFocus],
  );

  useEffect(() => {
    if (!digestSections.length) {
      setActiveDigestSection(null);
      return;
    }

    setActiveDigestSection((current) => {
      if (current && digestSections.some((section) => section.title === current)) {
        return current;
      }
      return digestSections[0].title;
    });
  }, [digestSections]);

  const digestSummary = digest?.summary || [];
  const activeDigestSectionData =
    digestSections.find((section) => section.title === activeDigestSection) || digestSections[0];

  const totalVisibleDigestItems = digestSections.reduce(
    (sum, section) => sum + section.filteredItems.length,
    0,
  );
  const totalVisiblePositiveItems = digestSections.reduce(
    (sum, section) => sum + section.filteredItems.filter((item) => item.isPositive === true).length,
    0,
  );
  const digestMomentumScore =
    totalVisibleDigestItems > 0
      ? Math.round((totalVisiblePositiveItems / totalVisibleDigestItems) * 100)
      : 0;

  if (!isAuthenticated) return <DigestSigninNotice />;
  if (digestLoading) return <DigestLoadingState />;
  if (!digest || !digestSections.length) return <DigestEmptyState />;

  return (
    <div className="space-y-5">
      <DigestHero
        digest={digest}
        digestSectionsCount={digestSections.length}
        totalVisibleDigestItems={totalVisibleDigestItems}
        digestMomentumScore={digestMomentumScore}
      />

      <FocusLensSelector digestFocus={digestFocus} onFocusChange={setDigestFocus} />
      <SnapshotCards digestSummary={digestSummary} />

      <SectionExplorer
        digestSections={digestSections}
        activeDigestSection={activeDigestSection}
        onSectionSelect={setActiveDigestSection}
      />

      {activeDigestSectionData && <SectionSpotlight section={activeDigestSectionData} />}
      <DigestDeepDive digestSections={digestSections} />

      <p className="text-center text-xs text-muted-foreground">
        Report window: {digest.periodLabel} | Generated{" "}
        {formatDistanceToNow(new Date(digest.generatedAt), { addSuffix: true })}
      </p>
    </div>
  );
}
