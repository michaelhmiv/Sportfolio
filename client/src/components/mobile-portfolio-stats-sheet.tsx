import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronUp, DollarSign } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NetWorthChangeSummary {
  amount: number | null;
  percent: number | null;
  rank: number | null;
}

interface MobilePortfolioStatsSheetProps {
  user: {
    balance: string;
    portfolioValue: string;
    netWorth: string;
    cashRank: number;
    portfolioRank: number;
    cashRankChange: number | null;
    portfolioRankChange: number | null;
    change24h: NetWorthChangeSummary;
    change7d: NetWorthChangeSummary;
    change30d: NetWorthChangeSummary;
  };
  onOpenPortfolio: () => void;
  onOpenLeaderboard: (target: "portfolioValue" | "cashBalance") => void;
}

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const fullCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function formatCompactCurrency(value: number) {
  return compactCurrencyFormatter.format(value);
}

function formatFullCurrency(value: number) {
  return fullCurrencyFormatter.format(value);
}

function formatSignedCurrency(value: number | null) {
  if (value === null || Number.isNaN(value)) return "--";
  const absolute = compactNumberFormatter
    .format(Math.abs(value))
    .replace("K", "k")
    .replace("M", "m")
    .replace("B", "b")
    .replace("T", "t");

  if (value > 0) return `+${absolute}`;
  if (value < 0) return `-${absolute}`;
  return "0";
}

function formatSignedPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) return "--";
  const absolute = Math.abs(value).toFixed(2);

  if (value > 0) return `+${absolute}%`;
  if (value < 0) return `-${absolute}%`;
  return "0.00%";
}

function getChangeClassName(value: number | null) {
  if (value === null || Number.isNaN(value)) return "text-[#787b86]";
  if (value > 0) return "text-[#22ab94]";
  if (value < 0) return "text-[#f23645]";
  return "text-[#b2b5be]";
}

function RankDelta({ value }: { value: number | null }) {
  if (value === null || value === 0) return null;

  if (value > 0) {
    return <ArrowUp className="h-2.5 w-2.5 text-positive" aria-label="Rank improved" />;
  }

  return <ArrowDown className="h-2.5 w-2.5 text-negative" aria-label="Rank decreased" />;
}

export function MobilePortfolioStatsSheet({
  user,
  onOpenPortfolio,
  onOpenLeaderboard,
}: MobilePortfolioStatsSheetProps) {
  const [open, setOpen] = useState(false);

  const netWorthValue = Number.parseFloat(user.netWorth || "0");
  const portfolioValue = Number.parseFloat(user.portfolioValue || "0");
  const cashValue = Number.parseFloat(user.balance || "0");

  const openPortfolio = () => {
    setOpen(false);
    onOpenPortfolio();
  };

  const openLeaderboard = (target: "portfolioValue" | "cashBalance") => {
    setOpen(false);
    onOpenLeaderboard(target);
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          type="button"
          className={cn(
            "fixed bottom-[4.5rem] left-1/2 z-[55] flex -translate-x-1/2 items-center gap-1.5 rounded-md border border-[#2a2e39] bg-[#131722] px-3 py-1.5 shadow-[0_8px_22px_rgba(0,0,0,0.4)] sm:hidden",
            "transition-colors hover:bg-[#1e222d] active:scale-[0.98]",
            open && "pointer-events-none opacity-0",
          )}
          data-testid="button-mobile-portfolio-stats-trigger"
          aria-label="Open portfolio snapshot"
        >
          <ChevronUp className="h-3.5 w-3.5 text-[#787b86]" />
          <span className="h-3 w-px bg-[#2a2e39]" />
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[#d1d4dc]">
            <DollarSign className="h-3.5 w-3.5 text-[#2962ff]" />
            <span data-testid="text-mobile-portfolio-trigger-value">
              {formatCompactCurrency(netWorthValue)}
            </span>
          </span>
        </button>
      </DrawerTrigger>

      <DrawerContent className="border-[#2a2e39] bg-[#131722] text-[#d1d4dc] sm:hidden">
        <div className="mx-auto w-full max-w-md pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
          <DrawerHeader className="gap-1 pb-2 text-left">
            <div className="flex items-center justify-between">
              <DrawerTitle className="text-sm font-semibold uppercase tracking-[0.14em] text-[#d1d4dc]">
                Portfolio Stats
              </DrawerTitle>
              <span className="rounded border border-[#2a2e39] bg-[#1e222d] px-1.5 py-0.5 text-[10px] text-[#b2b5be]">
                USD
              </span>
            </div>
          </DrawerHeader>

          <div className="space-y-3 px-4 pb-4" data-testid="mobile-portfolio-stats-sheet">
            <div className="rounded-md border border-[#2a2e39] bg-[#1e222d] p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-[#787b86]">
                    Net Worth
                  </div>
                  <div className="mt-1 font-mono text-lg font-semibold leading-none text-[#d1d4dc]">
                    {formatFullCurrency(netWorthValue)}
                  </div>
                </div>

                <div className="min-w-0 text-right">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-[#787b86]">
                    Cash Available
                  </div>
                  <div className="mt-1 font-mono text-lg font-semibold leading-none text-[#d1d4dc]">
                    {formatFullCurrency(cashValue)}
                  </div>
                  {user.cashRank > 0 && (
                    <button
                      type="button"
                      onClick={() => openLeaderboard("cashBalance")}
                      className="mt-1 inline-flex items-center gap-0.5 rounded border border-[#2a2e39] bg-[#131722] px-1 py-0 text-[10px] text-[#b2b5be] transition-colors hover:bg-[#2a2e39]"
                      data-testid="badge-mobile-cash-rank"
                      aria-label={`Open cash leaderboard. Rank ${user.cashRank}`}
                    >
                      #{user.cashRank}
                      <RankDelta value={user.cashRankChange} />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-[#2a2e39] pt-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[#787b86]">
                  Invested Value
                </div>
                <div className="font-mono text-sm font-semibold text-[#d1d4dc]">
                  {formatFullCurrency(portfolioValue)}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-md border border-[#2a2e39] bg-[#1e222d]">
              <table className="w-full table-fixed">
                <colgroup>
                  <col className="w-[3.5rem]" />
                  <col />
                  <col className="w-[5rem]" />
                  <col className="w-[3.75rem]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-[#2a2e39] text-[10px] font-medium text-[#787b86]">
                    <th className="px-2.5 py-2 text-left font-medium">Range</th>
                    <th className="px-1.5 py-2 text-right font-medium">P/L</th>
                    <th className="px-1.5 py-2 text-right font-medium">%</th>
                    <th className="px-2.5 py-2 text-right font-medium">Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: "24h", change: user.change24h, testId: "mobile-networth-24h" },
                    { key: "7d", change: user.change7d, testId: "mobile-networth-7d" },
                    { key: "30d", change: user.change30d, testId: "mobile-networth-30d" },
                  ].map((metric) => {
                    const change = metric.change ?? { amount: null, percent: null, rank: null };

                    return (
                      <tr
                        key={metric.key}
                        role="button"
                        tabIndex={0}
                        onClick={openPortfolio}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openPortfolio();
                          }
                        }}
                        className="cursor-pointer border-b border-[#2a2e39] transition-colors last:border-b-0 hover:bg-[#131722]"
                        data-testid={metric.testId}
                        aria-label={`Open portfolio details for ${metric.key} net worth change`}
                      >
                        <td className="px-2.5 py-2 text-left text-[11px] font-medium uppercase text-[#b2b5be]">
                          {metric.key}
                        </td>
                        <td
                          className={cn(
                            "whitespace-nowrap px-1.5 py-2 text-right font-mono tabular-nums text-xs font-semibold",
                            getChangeClassName(change.amount),
                          )}
                        >
                          {formatSignedCurrency(change.amount)}
                        </td>
                        <td
                          className={cn(
                            "whitespace-nowrap px-1.5 py-2 text-right font-mono tabular-nums text-xs font-semibold",
                            getChangeClassName(change.percent),
                          )}
                        >
                          {formatSignedPercent(change.percent)}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-2 text-right text-[11px] font-medium tabular-nums text-[#b2b5be]">
                          {change.rank !== null && change.rank > 0 ? `#${change.rank}` : "--"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Button
              onClick={openPortfolio}
              variant="outline"
              className="w-full border-[#2a2e39] bg-[#1e222d] font-medium uppercase tracking-[0.12em] text-[#d1d4dc] hover:bg-[#2a2e39] hover:text-[#d1d4dc]"
              data-testid="button-mobile-open-portfolio"
            >
              Open Portfolio
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
