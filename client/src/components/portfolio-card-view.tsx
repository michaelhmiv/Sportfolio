import { useState } from "react";

import { PlayerName } from "@/components/player-name";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ShareBreakdown {
  quantity: number;
  multiplier: number;
  effectiveShares: string;
  avgCostBasis: string;
  availableQuantity: number;
  id?: string;
}

interface PlayerGroup {
  player: {
    id: string;
    firstName: string;
    lastName: string;
    team: string;
    position: string;
    lastTradePrice: string | null;
  };
  regular: ShareBreakdown | null;
  stacked: ShareBreakdown[];
  totalShares: number;
  totalPower: string;
  stackPower: number;
  currentValue: string;
  pnl: string;
  pnlPercent: string;
  avgCostBasis: string;
  marketStatus: "priced" | "unpriced";
  marketPrice: number | null;
}

interface PortfolioCardViewProps {
  holdings: PlayerGroup[];
  lpPositions?: Array<{ playerId: string; equivalentShares: number }>;
  onStackShares: (playerId: string, playerName: string, availableShares: number) => void;
  onSelectPlayer: (playerId: string) => void;
  sortField: string;
}

function getMultiplierTierColor(multiplier: number): string {
  if (multiplier >= 50) return "bg-tier-mythic text-content-inverse";
  if (multiplier >= 20) return "bg-tier-legendary text-content-inverse";
  if (multiplier >= 10) return "bg-tier-elite text-content-inverse";
  if (multiplier >= 5) return "bg-tier-boosted text-content-inverse";
  return "bg-tier-standard text-content-inverse";
}

function getMultiplierTierBg(multiplier: number): string {
  if (multiplier >= 50) return "bg-tier-mythic/20";
  if (multiplier >= 20) return "bg-tier-legendary/20";
  if (multiplier >= 10) return "bg-tier-elite/20";
  if (multiplier >= 5) return "bg-tier-boosted/20";
  return "bg-tier-standard/20";
}

export function PortfolioCardView({
  holdings,
  lpPositions,
  onStackShares,
  onSelectPlayer,
  sortField,
}: PortfolioCardViewProps) {
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerGroup | null>(null);

  const formatShareCount = (value: number): string =>
    Number.isInteger(value) ? value.toString() : value.toFixed(2);

  const getSortValue = (group: PlayerGroup): string => {
    const singlesCount = group.regular?.quantity || 0;
    const stackPower = group.stackPower;

    switch (sortField) {
      case "quantity":
      case "singles":
        return `${formatShareCount(singlesCount)} shares`;
      case "stackPower":
        return `${stackPower.toFixed(2)}p`;
      case "value":
        return group.marketStatus === "unpriced" ? "Unpriced" : `$${group.currentValue}`;
      case "pnl":
        return group.marketStatus === "unpriced"
          ? "Unpriced"
          : `${parseFloat(group.pnl) >= 0 ? "+" : ""}$${group.pnl}`;
      case "avgCost":
        return `$${group.avgCostBasis}`;
      case "price":
        return group.marketPrice == null ? "Unpriced" : `$${group.marketPrice.toFixed(2)}`;
      default:
        return group.marketStatus === "unpriced" ? "Unpriced" : `$${group.currentValue}`;
    }
  };

  const getSortLabel = (): string => {
    switch (sortField) {
      case "singles":
        return "Shares";
      case "quantity":
        return "Shares";
      case "stackPower":
        return "Power";
      case "value":
        return "Value";
      case "pnl":
        return "P&L";
      case "avgCost":
        return "Avg Cost";
      case "price":
        return "Price";
      default:
        return "Value";
    }
  };

  const handleMultiplierBadgeClick = (event: React.MouseEvent, group: PlayerGroup) => {
    event.stopPropagation();
    setSelectedPlayer(group);
  };

  return (
    <>
      <div className="grid grid-cols-3 gap-2 p-2">
        {holdings.map((group) => {
          const hasStackedShares = group.stackPower > 0;
          const availableToStack = group.regular?.availableQuantity || 0;
          const canStackShares = availableToStack >= 4;
          const effectiveShares = parseFloat(group.totalPower);
          const lpPosition = lpPositions?.find((entry) => entry.playerId === group.player.id);
          const lpShares = lpPosition ? Math.round(lpPosition.equivalentShares || 0) : 0;

          return (
            <Card
              key={group.player.id}
              className="cursor-pointer border-2 border-border bg-card transition-shadow hover:border-primary/50 hover:shadow-md"
              onClick={() => onSelectPlayer(group.player.id)}
            >
              <CardContent className="p-2">
                <div className="mb-1 flex justify-end">
                  {effectiveShares > 0 ? (
                    <Badge
                      className={`${getMultiplierTierColor(effectiveShares)} h-4 cursor-pointer px-1 py-0 text-[10px] hover:opacity-80`}
                      onClick={(event) => handleMultiplierBadgeClick(event, group)}
                    >
                      {group.totalPower} gameplay power
                    </Badge>
                  ) : (
                    <div className="h-4" />
                  )}
                </div>

                <div className="mb-1 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {getSortLabel()}
                  </div>
                  <div
                    className={`text-lg font-mono font-bold ${
                      sortField === "pnl"
                        ? parseFloat(group.pnl) >= 0
                          ? "text-market-positive"
                          : "text-market-negative"
                        : ""
                    }`}
                  >
                    {getSortValue(group)}
                  </div>
                </div>

                <div className="mb-2 text-center">
                  <PlayerName
                    playerId={group.player.id}
                    firstName={group.player.firstName}
                    lastName={group.player.lastName}
                    className="text-sm font-bold hover:underline"
                  />
                </div>

                <div className="mb-1 flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
                  <span>{group.totalShares} Singles</span>
                  {lpShares > 0 && <span className="text-category-liquidity">({lpShares}p)</span>}
                  {hasStackedShares && (
                    <span className="text-category-stacking">
                      {formatShareCount(group.stackPower)}p Stack Power
                    </span>
                  )}
                </div>

                <div className="text-center">
                  {canStackShares ? (
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center gap-1 rounded-compact border border-category-stacking/30 bg-category-stacking/10 px-3 py-1 text-[10px] text-category-stacking sm:min-h-8"
                      onClick={(event) => {
                        event.stopPropagation();
                        onStackShares(
                          group.player.id,
                          `${group.player.firstName} ${group.player.lastName}`,
                          availableToStack,
                        );
                      }}
                    >
                      Stack
                    </button>
                  ) : (
                    <div className="text-[10px] text-muted-foreground">
                      {formatShareCount(availableToStack)}/4 unlocked
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!selectedPlayer} onOpenChange={() => setSelectedPlayer(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Power Breakdown</DialogTitle>
          </DialogHeader>

          {selectedPlayer && (
            <div className="space-y-4">
              {(() => {
                const regularHolding = selectedPlayer.regular;
                const stackableShares = regularHolding
                  ? Math.floor(regularHolding.availableQuantity / 2) * 2
                  : 0;

                return (
                  <>
                    <div className="flex items-center justify-between border-b pb-3">
                      <div>
                        <PlayerName
                          playerId={selectedPlayer.player.id}
                          firstName={selectedPlayer.player.firstName}
                          lastName={selectedPlayer.player.lastName}
                          className="text-lg font-bold"
                        />
                        <div className="text-sm text-muted-foreground">
                          {selectedPlayer.player.team} | {selectedPlayer.player.position}
                        </div>
                      </div>
                      <Badge
                        className={`${getMultiplierTierColor(parseFloat(selectedPlayer.totalPower))} text-sm`}
                      >
                        {selectedPlayer.totalPower} gameplay power
                      </Badge>
                    </div>

                    <div className="max-h-[300px] space-y-2 overflow-y-auto">
                      {selectedPlayer.regular && selectedPlayer.regular.quantity > 0 && (
                        <div className="flex items-center justify-between rounded-compact border border-market-positive/20 bg-market-positive/10 p-3">
                          <div className="flex items-center gap-3">
                            <div className="h-3 w-3 rounded-compact bg-market-positive" />
                            <div>
                              <div className="font-medium">Raw Shares</div>
                              <div className="text-sm text-muted-foreground">1x each</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-mono font-bold">
                              {formatShareCount(selectedPlayer.regular.quantity)}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {formatShareCount(selectedPlayer.regular.availableQuantity)} unlocked
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedPlayer.stackPower > 0 && (
                        <div className="flex items-center justify-between rounded-compact border border-category-stacking/30 bg-category-stacking/10 p-3">
                          <div className="flex items-center gap-3">
                            <div className="h-3 w-3 rounded-compact bg-category-stacking" />
                            <div>
                              <div className="font-medium text-content">Stack Power</div>
                              <div className="text-sm text-muted-foreground">
                                Non-tradeable gameplay inventory
                              </div>
                            </div>
                          </div>
                          <div className="text-lg font-mono font-bold text-category-stacking">
                            {formatShareCount(selectedPlayer.stackPower)}p
                          </div>
                        </div>
                      )}

                      {selectedPlayer.stacked.map((share, index) => (
                        <div
                          key={share.id || index}
                          className={`flex items-center justify-between rounded-compact border border-category-stacking/30 p-3 ${getMultiplierTierBg(share.multiplier)}`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`h-3 w-3 rounded-compact ${getMultiplierTierColor(share.multiplier).split(" ")[0]}`}
                            />
                            <div>
                              <div className="font-medium text-content">
                                Stacked Share {share.multiplier}x
                              </div>
                              <div className="text-sm text-muted-foreground">1 share retained</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-mono font-bold text-content">
                              {formatShareCount(share.quantity)}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {share.effectiveShares} effective shares
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {regularHolding && regularHolding.availableQuantity >= 4 && (
                      <Button
                        variant="outline"
                        className="w-full border-category-stacking/40 bg-category-stacking/10 text-category-stacking hover:bg-hover hover:text-category-stacking"
                        onClick={() => {
                          onStackShares(
                            selectedPlayer.player.id,
                            `${selectedPlayer.player.firstName} ${selectedPlayer.player.lastName}`,
                            regularHolding.availableQuantity,
                          );
                          setSelectedPlayer(null);
                        }}
                      >
                        Stack Shares {formatShareCount(stackableShares)}
                      </Button>
                    )}

                    <div className="text-center text-xs text-muted-foreground">
                      Minimum 4 unlocked raw shares. Use an even share count. N shares become 1
                      stacked share at N/2.
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
