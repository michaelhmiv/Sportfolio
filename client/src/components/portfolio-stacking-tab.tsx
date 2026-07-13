import { useMemo, useState } from "react";
import { format } from "date-fns";

import { matchesPlayerSearch } from "@/lib/player-search";
import { cn } from "@/lib/utils";
import {
  type StackingCandidate,
  type StackingCandidateStatus,
  type StackingSortField,
  sortStackingCandidates,
} from "@/pages/portfolio-stacking-helpers";
import { PlayerName } from "@/components/player-name";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PortfolioStackingTabProps {
  candidates: StackingCandidate[];
  onSelectPlayer: (playerId: string) => void;
  onStackShares: (playerId: string, playerName: string, availableShares: number) => void;
}

function formatShareCount(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function getCandidateStatusLabel(status: StackingCandidateStatus): string {
  switch (status) {
    case "stack-ready":
      return "Ready";
    case "almost-ready":
      return "Close";
    case "already-stacked":
      return "Stacked";
    default:
      return "Stack";
  }
}

function getCandidateStatusClasses(status: StackingCandidateStatus): string {
  switch (status) {
    case "stack-ready":
      return "border-market-positive/35 bg-market-positive/10 text-market-positive";
    case "almost-ready":
      return "border-status-warning/35 bg-status-warning/10 text-status-warning";
    case "already-stacked":
      return "border-category-stacking/35 bg-category-stacking/10 text-category-stacking";
    default:
      return "border-border bg-muted/40 text-foreground";
  }
}

function getGameStatusLabel(candidate: StackingCandidate): string {
  if (candidate.gameStatus === "live") return "LIVE";
  if (candidate.gameStatus === "ended") return "FINAL";
  if (candidate.gameStatus === "upcoming" && candidate.gameStartTime) {
    return format(new Date(candidate.gameStartTime), "EEE h:mm a");
  }
  if (candidate.gameStatus === "upcoming") return "Upcoming";
  return "No slate";
}

function getGameStatusClassName(candidate: StackingCandidate): string {
  if (candidate.gameStatus === "live") return "text-status-live";
  if (candidate.gameStatus === "ended") return "text-content-muted";
  if (candidate.gameStatus === "upcoming") return "text-status-info";
  return "text-muted-foreground";
}

function getSinglesSecondary(candidate: StackingCandidate): string {
  if (candidate.availableToStack >= 4) {
    return "Ready to add";
  }

  const sharesNeeded = Math.max(0, 4 - candidate.availableToStack);
  return `Need ${formatShareCount(sharesNeeded)}`;
}

function getCurrentStackPrimary(candidate: StackingCandidate): string {
  if (candidate.bestStackedMultiplier > 1) {
    return `${formatShareCount(candidate.bestStackedMultiplier)}x`;
  }

  return "None";
}

function getCurrentStackSecondary(candidate: StackingCandidate): string {
  if (candidate.stackedShareCount > 0) {
    return `${formatShareCount(candidate.stackedShareCount)} stacked`;
  }

  return "No stack yet";
}

export function PortfolioStackingTab({
  candidates,
  onSelectPlayer,
  onStackShares,
}: PortfolioStackingTabProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | StackingCandidateStatus>("all");
  const [sortField, setSortField] = useState<StackingSortField>("ready");

  const summary = useMemo(
    () => ({
      readyCount: candidates.filter((candidate) => candidate.status === "stack-ready").length,
      singlesAvailable: candidates.reduce((sum, candidate) => sum + candidate.availableToStack, 0),
      stackedPlayers: candidates.filter((candidate) => candidate.stackedShareCount > 0).length,
    }),
    [candidates],
  );

  const filteredCandidates = useMemo(() => {
    let result = candidates.filter((candidate) =>
      matchesPlayerSearch(
        {
          id: candidate.player.id,
          firstName: candidate.player.firstName,
          lastName: candidate.player.lastName,
          team: candidate.player.team,
          position: candidate.player.position,
          sport: candidate.player.sport,
        },
        search,
      ),
    );

    if (statusFilter !== "all") {
      result = result.filter((candidate) => candidate.status === statusFilter);
    }

    return sortStackingCandidates(result, sortField);
  }, [candidates, search, sortField, statusFilter]);

  return (
    <Card>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-sm font-medium uppercase tracking-wide">
              Stacking Board
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Focused on unlocked singles you can add and the stack level you already hold.
            </p>
          </div>
          <Badge variant="outline" className="h-6 text-[10px] uppercase tracking-wide">
            {candidates.length} tracked
          </Badge>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-compact border border-border/70 bg-muted/20 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Ready</div>
            <div className="mt-0.5 font-mono text-sm font-semibold">{summary.readyCount}</div>
          </div>
          <div className="rounded-compact border border-border/70 bg-muted/20 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Singles Avail
            </div>
            <div className="mt-0.5 font-mono text-sm font-semibold">
              {formatShareCount(summary.singlesAvailable)}
            </div>
          </div>
          <div className="rounded-compact border border-border/70 bg-muted/20 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Stacked</div>
            <div className="mt-0.5 font-mono text-sm font-semibold">{summary.stackedPlayers}</div>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            variant="terminal"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search player, team, position..."
            className="h-8 text-xs"
          />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as "all" | StackingCandidateStatus)}
            >
              <SelectTrigger className="h-8 text-xs sm:w-[120px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="stack-ready">Ready</SelectItem>
                <SelectItem value="almost-ready">Close</SelectItem>
                <SelectItem value="already-stacked">Stacked</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={sortField}
              onValueChange={(value) => setSortField(value as StackingSortField)}
            >
              <SelectTrigger className="h-8 text-xs sm:w-[140px]">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ready">Best setup</SelectItem>
                <SelectItem value="available">Singles avail</SelectItem>
                <SelectItem value="best-stacked">Current stack</SelectItem>
                <SelectItem value="game">Game timing</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {candidates.length === 0 ? (
          <EmptyState
            icon="wallet"
            title="No stack candidates yet"
            description="Build player holdings first, then come back here to compare stacking options."
            size="sm"
            className="py-10"
            data-testid="empty-stacking"
          />
        ) : filteredCandidates.length === 0 ? (
          <EmptyState
            icon="search"
            title="No players match those filters"
            description="Adjust search or status filters to see more stacking setups."
            size="sm"
            className="py-10"
            data-testid="empty-stacking-filtered"
          />
        ) : (
          <div>
            <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground">
              <span>
                Showing {filteredCandidates.length} of {candidates.length} stack candidates
              </span>
              <span className="hidden sm:inline">Singles available plus current stack only</span>
            </div>

            <div className="overflow-hidden rounded-b-md">
              <table className="w-full table-fixed text-xs">
                <thead>
                  <tr className="border-b border-border/70 bg-muted/20">
                    <th className="w-[46%] px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:w-[38%]">
                      Player
                    </th>
                    <th className="w-[22%] px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:w-[20%]">
                      Singles
                    </th>
                    <th className="w-[20%] px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:w-[22%]">
                      Current Stack
                    </th>
                    <th className="w-[12%] px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:w-[20%]">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCandidates.map((candidate, index) => {
                    const playerName =
                      `${candidate.player.firstName || ""} ${candidate.player.lastName || ""}`.trim();
                    const displayName = playerName || "Selected player";
                    const canStack = candidate.status === "stack-ready";
                    const rowMeta = [
                      candidate.player.team,
                      candidate.player.position,
                      candidate.player.sport,
                    ]
                      .filter(Boolean)
                      .join(" | ");

                    return (
                      <tr
                        key={candidate.playerId}
                        className={cn(
                          "border-b border-border/60 align-top hover:bg-muted/20",
                          index === filteredCandidates.length - 1 && "border-b-0",
                          canStack && "bg-market-positive/[0.04]",
                        )}
                        data-testid={`stacking-row-${candidate.playerId}`}
                      >
                        <td className="px-2 py-2 align-middle">
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => onSelectPlayer(candidate.playerId)}
                              className="block min-w-0 text-left hover:underline"
                            >
                              <PlayerName
                                playerId={candidate.playerId}
                                firstName={candidate.player.firstName}
                                lastName={candidate.player.lastName}
                                className="truncate text-xs font-semibold sm:text-sm"
                              />
                            </button>
                            <div className="mt-0.5 truncate text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                              {rowMeta}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "h-4 px-1 text-[9px] uppercase tracking-wide",
                                  getCandidateStatusClasses(candidate.status),
                                )}
                              >
                                {getCandidateStatusLabel(candidate.status)}
                              </Badge>
                              <span
                                className={cn(
                                  "truncate text-[10px]",
                                  getGameStatusClassName(candidate),
                                )}
                              >
                                {getGameStatusLabel(candidate)}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="px-2 py-2 align-middle">
                          <div className="font-mono text-[10px] font-semibold text-foreground sm:text-xs">
                            {formatShareCount(candidate.availableToStack)}
                          </div>
                          <div className="mt-1 truncate text-[10px] text-muted-foreground">
                            {getSinglesSecondary(candidate)}
                          </div>
                        </td>

                        <td className="px-2 py-2 align-middle">
                          <div className="font-mono text-[10px] font-semibold text-foreground sm:text-xs">
                            {getCurrentStackPrimary(candidate)}
                          </div>
                          <div className="mt-1 truncate text-[10px] text-muted-foreground">
                            {getCurrentStackSecondary(candidate)}
                          </div>
                        </td>

                        <td className="px-2 py-2 align-middle text-right">
                          <div className="flex flex-col items-end gap-1">
                            <Button
                              size="sm"
                              variant={canStack ? "terminal" : "terminalOutline"}
                              className="h-7 px-2 text-[10px] uppercase tracking-wide"
                              onClick={() =>
                                onStackShares(
                                  candidate.playerId,
                                  displayName,
                                  candidate.availableToStack,
                                )
                              }
                              disabled={!canStack}
                            >
                              Stack
                            </Button>
                            <button
                              type="button"
                              onClick={() => onSelectPlayer(candidate.playerId)}
                              className="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                            >
                              View
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
