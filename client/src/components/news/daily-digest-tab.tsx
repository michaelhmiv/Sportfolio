import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import type { LucideIcon } from "lucide-react";
import { BarChart3, Clock, Target, TrendingUp, Wallet } from "lucide-react";
import { Link } from "wouter";

import { PlayerLinkedText } from "@/components/player-linked-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useScout } from "@/lib/scout-context";
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

type BriefTone = "positive" | "negative" | "neutral";

type BriefStat = {
  label: string;
  value: string;
  detail?: string;
  tone: BriefTone;
};

type BriefCard = {
  title: string;
  label: string;
  value: string;
  detail?: string;
  badge?: string;
  tone: BriefTone;
};

type BriefRow = {
  label: string;
  value: string;
  detail?: string;
  badge?: string;
  tone: BriefTone;
};

type DailyBriefModel = {
  headline: string;
  headlineTone: BriefTone;
  keyStats: BriefStat[];
  whatMattered: BriefCard[];
  todaySetup: BriefCard[];
  portfolioMovers: BriefRow[];
  leagueMovers: BriefRow[];
};

const HIDDEN_SECTION_TITLES = new Set(["Vesting Activity", "Contest Results"]);
const SCOUT_BASE_ITEM_LABELS = new Set([
  "Shares Scouted",
  "Scout Minutes",
  "Scouting Efficiency",
  "Active Scouts",
]);
const PORTFOLIO_HEALTH_BASE_ITEM_LABELS = new Set(["Net Worth"]);

function getBriefTone(isPositive?: boolean): BriefTone {
  if (isPositive === true) return "positive";
  if (isPositive === false) return "negative";
  return "neutral";
}

function findSummaryItem(
  summary: DigestSummaryItem[] | undefined,
  label: string,
): DigestSummaryItem | undefined {
  return summary?.find((item) => item.label === label);
}

function findSection(
  sections: DigestSection[] | undefined,
  title: string,
): DigestSection | undefined {
  return sections?.find((section) => section.title === title);
}

function findSectionItem(
  section: DigestSection | undefined,
  label: string,
): DigestItem | undefined {
  return section?.items.find((item) => item.label === label);
}

function findSectionItemByPrefix(
  section: DigestSection | undefined,
  prefix: string,
): DigestItem | undefined {
  return section?.items.find((item) => item.label.startsWith(prefix));
}

function getDynamicItems(
  section: DigestSection | undefined,
  baseLabels: Set<string>,
): DigestItem[] {
  if (!section) return [];
  return section.items.filter((item) => !baseLabels.has(item.label));
}

function parseNumericValue(value?: string | null): number | null {
  if (!value) return null;

  const match = value.replace(/,/g, "").match(/[-+]?\d+(\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCurrencyValue(value?: string | null): string {
  const numeric = parseNumericValue(value);
  if (numeric === null) return value || "$0.00";
  return `$${numeric.toFixed(2)}`;
}

function stripLeadingMarker(label: string): string {
  return label.replace(/^[^A-Za-z0-9$]+/, "").trim();
}

function stripPrefix(label: string, prefix: string): string {
  if (!label.startsWith(prefix)) return stripLeadingMarker(label);
  return stripLeadingMarker(label.slice(prefix.length).trim());
}

function getHeaderBadgeLabel(tone: BriefTone): string {
  if (tone === "positive") return "In the green";
  if (tone === "negative") return "Needs attention";
  return "Daily check-in";
}

function getToneBadgeClasses(tone: BriefTone): string {
  if (tone === "positive") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-500";
  }

  if (tone === "negative") {
    return "border-rose-500/20 bg-rose-500/10 text-rose-500";
  }

  return "border-border bg-[hsl(var(--sidebar)/0.45)] text-muted-foreground";
}

function getHeadline(summary: DigestSummaryItem[] | undefined): {
  headline: string;
  headlineTone: BriefTone;
} {
  const pnl = findSummaryItem(summary, "Yesterday P/L");
  const numeric = parseNumericValue(pnl?.value);

  if (numeric === null) {
    return {
      headline: "Your account recap for yesterday",
      headlineTone: "neutral",
    };
  }

  if (numeric > 0) {
    return {
      headline: `Up $${numeric.toFixed(2)} yesterday`,
      headlineTone: "positive",
    };
  }

  if (numeric < 0) {
    return {
      headline: `Down $${Math.abs(numeric).toFixed(2)} yesterday`,
      headlineTone: "negative",
    };
  }

  return {
    headline: "Flat yesterday",
    headlineTone: "neutral",
  };
}

function buildDailyBriefModel(
  digest: Digest,
  scoutCapacity: number,
  availableBalance?: string,
): DailyBriefModel {
  const visibleSections = digest.sections.filter(
    (section) => !HIDDEN_SECTION_TITLES.has(section.title),
  );
  const summary = digest.summary || [];

  const portfolioHealth = findSection(visibleSections, "Portfolio Health");
  const scoutActivity = findSection(visibleSections, "Scout Activity");
  const boostPerformance = findSection(visibleSections, "Boost Performance");
  const portfolioAttribution = findSection(visibleSections, "Portfolio Attribution");
  const marketMovers = findSection(visibleSections, "Market Movers");

  const netWorth = findSummaryItem(summary, "Net Worth");
  const dailyPnl = findSummaryItem(summary, "Yesterday P/L");
  const cashEarnings = findSummaryItem(summary, "Cash Earnings");
  const sharesScouted = findSummaryItem(summary, "Shares Scouted");

  const keyStats: BriefStat[] = [
    netWorth
      ? {
          label: netWorth.label,
          value: netWorth.value,
          tone: getBriefTone(netWorth.isPositive),
        }
      : null,
    dailyPnl
      ? {
          label: dailyPnl.label,
          value: dailyPnl.value,
          detail: dailyPnl.change,
          tone: getBriefTone(dailyPnl.isPositive),
        }
      : null,
    cashEarnings
      ? {
          label: "Cash Earned",
          value: cashEarnings.value,
          tone: getBriefTone(cashEarnings.isPositive),
        }
      : null,
    sharesScouted
      ? {
          label: sharesScouted.label,
          value: sharesScouted.value,
          tone: getBriefTone(sharesScouted.isPositive),
        }
      : null,
  ].filter((item): item is BriefStat => Boolean(item));

  const topPositive = findSectionItemByPrefix(portfolioAttribution, "Top Positive: ");
  const topNegative = findSectionItemByPrefix(portfolioAttribution, "Top Negative: ");
  const bestBoost = findSectionItemByPrefix(boostPerformance, "Best Boost: ");
  const topScout = getDynamicItems(scoutActivity, SCOUT_BASE_ITEM_LABELS)[0];

  const whatMattered: BriefCard[] = [];

  if (topPositive) {
    whatMattered.push({
      title: "Top Winner",
      label: stripPrefix(topPositive.label, "Top Positive: "),
      value: topPositive.value,
      detail: "Largest positive contribution from the positions you hold.",
      badge: topPositive.change,
      tone: getBriefTone(topPositive.isPositive),
    });
  }

  if (topNegative) {
    whatMattered.push({
      title: "Top Drag",
      label: stripPrefix(topNegative.label, "Top Negative: "),
      value: topNegative.value,
      detail: "Biggest pullback across your held positions.",
      badge: topNegative.change,
      tone: getBriefTone(topNegative.isPositive),
    });
  }

  if (bestBoost) {
    whatMattered.push({
      title: "Best Boost",
      label: stripPrefix(bestBoost.label, "Best Boost: "),
      value: bestBoost.value,
      detail: "Highest settled boost payout from yesterday's slate.",
      badge: bestBoost.change,
      tone: getBriefTone(bestBoost.isPositive),
    });
  }

  if (topScout) {
    whatMattered.push({
      title: "Scout Leader",
      label: stripLeadingMarker(topScout.label),
      value: topScout.value,
      detail: "This player generated your best scouting output yesterday.",
      badge: topScout.change,
      tone: getBriefTone(topScout.isPositive),
    });
  }

  const boostsEntered =
    parseNumericValue(findSectionItem(boostPerformance, "Boosts Entered")?.value) || 0;
  const boostsSettled =
    parseNumericValue(findSectionItem(boostPerformance, "Boosts Settled")?.value) || 0;
  const boostHitRate = findSectionItem(boostPerformance, "Hit Rate");
  const activeScouts =
    parseNumericValue(findSectionItem(scoutActivity, "Active Scouts")?.value) || 0;
  const scoutingOutput =
    sharesScouted?.value || findSectionItem(scoutActivity, "Shares Scouted")?.value;
  const openScoutSlots = Math.max(scoutCapacity - activeScouts, 0);
  const availableBalanceValue = parseNumericValue(availableBalance) || 0;

  const todaySetup: BriefCard[] = [
    {
      title: "Boost Review",
      label:
        boostsEntered > 0
          ? `${boostsEntered} boost${boostsEntered === 1 ? "" : "s"} entered yesterday`
          : "No boosts entered yesterday",
      value:
        boostsEntered > 0
          ? boostHitRate?.value
            ? `${boostHitRate.value} hit rate`
            : `${boostsSettled} settled`
          : "5x-2x slots went unused",
      detail:
        boostsEntered > 0
          ? "Use yesterday's results to set up stronger 5x-2x slots before today's locks."
          : "Review today's boost slots early so you do not leave free leverage on the board again.",
      badge: bestBoost?.change,
      tone:
        boostsEntered === 0
          ? "negative"
          : getBriefTone(boostHitRate?.isPositive ?? (boostsSettled > 0 || undefined)),
    },
    {
      title: "Scouting Status",
      label: `${activeScouts} of ${scoutCapacity} scouts active`,
      value: scoutingOutput || "No scouting output",
      detail:
        openScoutSlots > 0
          ? `You still have ${openScoutSlots} open scout slot${openScoutSlots === 1 ? "" : "s"}.`
          : "All of your scout slots are working for you right now.",
      badge: `${activeScouts}/${scoutCapacity}`,
      tone: activeScouts === 0 ? "negative" : openScoutSlots > 0 ? "neutral" : "positive",
    },
  ];

  if (availableBalance !== undefined) {
    todaySetup.push({
      title: "Cash Ready",
      label:
        availableBalanceValue > 0
          ? "Balance available for player pools and LP adds"
          : "No free balance right now",
      value: formatCurrencyValue(availableBalance),
      detail:
        availableBalanceValue > 0
          ? "You have dry powder to deploy into player pools if today's setup looks favorable."
          : "Your liquid balance is fully committed, so new entries require a sale or fresh earnings.",
      tone: availableBalanceValue > 0 ? "positive" : "neutral",
    });
  }

  const contributionByPlayer = new Map<string, string>();
  if (topPositive) {
    contributionByPlayer.set(stripPrefix(topPositive.label, "Top Positive: "), topPositive.value);
  }
  if (topNegative) {
    contributionByPlayer.set(stripPrefix(topNegative.label, "Top Negative: "), topNegative.value);
  }

  const portfolioMovers = getDynamicItems(portfolioHealth, PORTFOLIO_HEALTH_BASE_ITEM_LABELS).map(
    (item) => {
      const name = stripLeadingMarker(item.label);
      const contribution = contributionByPlayer.get(name);

      return {
        label: name,
        value: item.value,
        detail: contribution
          ? `${contribution} estimated contribution`
          : "Held position from yesterday's recap.",
        badge: item.change,
        tone: getBriefTone(item.isPositive),
      };
    },
  );

  const leagueMovers = (marketMovers?.items || []).map((item) => ({
    label: stripLeadingMarker(item.label),
    value: item.value,
    detail: "Market-wide move across active players.",
    badge: item.change,
    tone: getBriefTone(item.isPositive),
  }));

  const { headline, headlineTone } = getHeadline(summary);

  return {
    headline,
    headlineTone,
    keyStats,
    whatMattered,
    todaySetup,
    portfolioMovers,
    leagueMovers,
  };
}

function DigestSigninNotice() {
  return (
    <Card variant="terminal">
      <CardContent className="py-12 text-center">
        <BarChart3 className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
        <h3 className="terminal-heading mb-1 text-sm">Sign In Required</h3>
        <p className="terminal-subtle">Sign in to see your personalized daily brief.</p>
      </CardContent>
    </Card>
  );
}

function DigestLoadingState() {
  return (
    <div className="space-y-4">
      <Card variant="terminal">
        <CardContent className="space-y-3 p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        {[...Array(4)].map((_, index) => (
          <Card key={index} variant="terminal">
            <CardContent className="space-y-3 p-4">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>

      {[...Array(3)].map((_, index) => (
        <Card key={`section-${index}`} variant="terminal">
          <CardContent className="space-y-3 p-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DigestEmptyState() {
  return (
    <Card variant="terminal">
      <CardContent className="py-12 text-center">
        <BarChart3 className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
        <h3 className="terminal-heading mb-1 text-sm">No Digest Available</h3>
        <p className="terminal-subtle">
          Your personalized daily brief will be generated daily at 6 AM ET.
        </p>
      </CardContent>
    </Card>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 px-1">
      <div className="terminal-strip px-2 py-1">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <h3 className="terminal-heading text-sm">{title}</h3>
        <p className="terminal-subtle mt-1">{description}</p>
      </div>
    </div>
  );
}

function DetailBadge({
  value,
  tone,
  className,
}: {
  value: string;
  tone: BriefTone;
  className?: string;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "w-fit rounded-sm border px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em]",
        getToneBadgeClasses(tone),
        className,
      )}
    >
      {value}
    </Badge>
  );
}

function BriefCardGrid({ cards }: { cards: BriefCard[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {cards.map((card) => (
        <Card key={`${card.title}-${card.label}`} variant="terminal">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="terminal-label">{card.title}</p>
              {card.badge ? <DetailBadge value={card.badge} tone={card.tone} /> : null}
            </div>

            <PlayerLinkedText
              text={card.label}
              className="block text-sm font-semibold leading-snug break-words"
            />

            <p className="terminal-value text-lg leading-tight">{card.value}</p>

            {card.detail ? <p className="terminal-subtle leading-relaxed">{card.detail}</p> : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ActionShortcutBar({ onOpenScouts }: { onOpenScouts: () => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <Button variant="outline" size="sm" className="w-full" onClick={onOpenScouts}>
        Manage Scouts
      </Button>
      <Button variant="outline" size="sm" className="w-full" asChild>
        <Link href="/boosts">Review Boosts</Link>
      </Button>
      <Button variant="outline" size="sm" className="w-full" asChild>
        <Link href="/pools">Browse Pools</Link>
      </Button>
    </div>
  );
}

function StatGrid({ stats }: { stats: BriefStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.map((stat) => (
        <Card key={stat.label} variant="terminal">
          <CardContent className="space-y-2 p-4">
            <p className="terminal-label">{stat.label}</p>
            <p className="terminal-value text-xl leading-tight">{stat.value}</p>
            {stat.detail ? <p className="terminal-subtle">{stat.detail}</p> : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function BriefRowList({ rows, emptyMessage }: { rows: BriefRow[]; emptyMessage: string }) {
  if (!rows.length) {
    return (
      <Card variant="terminal" className="border-dashed">
        <CardContent className="terminal-subtle p-4">{emptyMessage}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div
          key={`${row.label}-${row.value}-${row.badge || "row"}`}
          className="terminal-shell rounded-sm p-4"
        >
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <div className="min-w-0">
              <PlayerLinkedText
                text={row.label}
                className="block text-sm font-semibold leading-snug break-words"
              />
              {row.detail ? (
                <p className="terminal-subtle mt-1 leading-relaxed">{row.detail}</p>
              ) : null}
              {row.badge ? (
                <DetailBadge value={row.badge} tone={row.tone} className="mt-2" />
              ) : null}
            </div>
            <span className="terminal-value shrink-0 text-sm leading-tight">{row.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

interface DailyDigestTabProps {
  isAuthenticated: boolean;
  digestLoading: boolean;
  digest?: Digest;
  isPremium?: boolean;
  availableBalance?: string;
}

export function DailyDigestTab({
  isAuthenticated,
  digestLoading,
  digest,
  isPremium = false,
  availableBalance,
}: DailyDigestTabProps) {
  const [showAllLeagueMovers, setShowAllLeagueMovers] = useState(false);
  const { openScoutDashboard } = useScout();

  const scoutCapacity = isPremium ? 10 : 5;
  const dailyBrief = useMemo(() => {
    if (!digest) return null;
    return buildDailyBriefModel(digest, scoutCapacity, availableBalance);
  }, [availableBalance, digest, scoutCapacity]);

  if (!isAuthenticated) return <DigestSigninNotice />;
  if (digestLoading) return <DigestLoadingState />;
  if (!digest || !dailyBrief) return <DigestEmptyState />;

  const hasVisibleContent =
    dailyBrief.keyStats.length ||
    dailyBrief.whatMattered.length ||
    dailyBrief.todaySetup.length ||
    dailyBrief.portfolioMovers.length ||
    dailyBrief.leagueMovers.length;

  if (!hasVisibleContent) return <DigestEmptyState />;

  const visibleLeagueMovers = showAllLeagueMovers
    ? dailyBrief.leagueMovers
    : dailyBrief.leagueMovers.slice(0, 3);

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card variant="terminal">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="terminal-label">Daily Brief</p>
                <h2
                  className={cn(
                    "terminal-heading mt-1 text-xl leading-tight sm:text-2xl",
                    dailyBrief.headlineTone === "positive" && "text-emerald-500",
                    dailyBrief.headlineTone === "negative" && "text-rose-500",
                  )}
                >
                  {dailyBrief.headline}
                </h2>
                <p className="terminal-subtle mt-2 leading-relaxed">
                  Your portfolio, boosts, and scouting recap for {digest.periodLabel}.
                </p>
              </div>

              <Badge
                variant="secondary"
                className={cn(
                  "shrink-0 rounded-sm border px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em]",
                  getToneBadgeClasses(dailyBrief.headlineTone),
                )}
              >
                {getHeaderBadgeLabel(dailyBrief.headlineTone)}
              </Badge>
            </div>

            <div className="terminal-subtle flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" />
              Updated {formatDistanceToNow(new Date(digest.generatedAt), { addSuffix: true })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {dailyBrief.keyStats.length ? (
        <section className="space-y-3">
          <StatGrid stats={dailyBrief.keyStats} />
        </section>
      ) : null}

      {dailyBrief.whatMattered.length ? (
        <section className="space-y-3">
          <SectionHeading
            icon={TrendingUp}
            title="What Mattered"
            description="The biggest changes that actually moved your account yesterday."
          />
          <BriefCardGrid cards={dailyBrief.whatMattered} />
        </section>
      ) : null}

      {dailyBrief.todaySetup.length ? (
        <section className="space-y-3">
          <SectionHeading
            icon={Target}
            title="Today's Setup"
            description="Use yesterday's results to decide where to focus next."
          />
          <BriefCardGrid cards={dailyBrief.todaySetup} />
          <ActionShortcutBar onOpenScouts={openScoutDashboard} />
        </section>
      ) : null}

      <section className="space-y-3">
        <SectionHeading
          icon={Wallet}
          title="Portfolio Movers"
          description="The biggest 24-hour moves among the positions you already hold."
        />
        <BriefRowList
          rows={dailyBrief.portfolioMovers}
          emptyMessage="No held player movers to show yet. Once you build positions, your daily brief will surface them here."
        />
      </section>

      <section className="space-y-3">
        <SectionHeading
          icon={BarChart3}
          title="League Movers"
          description="Broader market context, kept below your own account signals."
        />
        <BriefRowList
          rows={visibleLeagueMovers}
          emptyMessage="No broad market movers were available for this report window."
        />
        {dailyBrief.leagueMovers.length > 3 ? (
          <Button
            variant="terminalOutline"
            size="sm"
            className="w-full"
            onClick={() => setShowAllLeagueMovers((current) => !current)}
          >
            {showAllLeagueMovers
              ? "Show fewer league movers"
              : `Show ${dailyBrief.leagueMovers.length - 3} more league movers`}
          </Button>
        ) : null}
      </section>

      <p className="terminal-subtle text-center">
        Built from your {digest.periodLabel} ET activity and the latest stored market snapshot.
      </p>
    </div>
  );
}
