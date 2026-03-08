import { useState } from "react";
import { Zap } from "lucide-react";

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
  currentValue: string;
  pnl: string;
  pnlPercent: string;
  avgCostBasis: string;
}

interface PortfolioCardViewProps {
  holdings: PlayerGroup[];
  lpPositions?: Array<{ playerId: string; equivalentShares: number }>;
  onStackShares: (playerId: string, playerName: string, availableShares: number) => void;
  onSelectPlayer: (playerId: string) => void;
  sortField: string;
}

function getMultiplierTierColor(multiplier: number): string {
  if (multiplier >= 50) return "bg-purple-600 text-white";
  if (multiplier >= 20) return "bg-purple-500 text-white";
  if (multiplier >= 10) return "bg-purple-400 text-white";
  if (multiplier >= 5) return "bg-purple-300 text-purple-900";
  return "bg-green-500 text-white";
}

function getMultiplierTierBg(multiplier: number): string {
  if (multiplier >= 50) return "bg-purple-600/20";
  if (multiplier >= 20) return "bg-purple-500/20";
  if (multiplier >= 10) return "bg-purple-400/20";
  if (multiplier >= 5) return "bg-purple-300/20";
  return "bg-green-500/20";
}

export function PortfolioCardView({
  holdings,
  lpPositions,
  onStackShares,
  onSelectPlayer,
  sortField,
}: PortfolioCardViewProps) {
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerGroup | null>(null);

  const getSortValue = (group: PlayerGroup): string => {
    switch (sortField) {
      case "quantity":
        return `${group.totalShares} shares`;
      case "value":
        return `$${group.currentValue}`;
      case "pnl":
        return `${parseFloat(group.pnl) >= 0 ? "+" : ""}$${group.pnl}`;
      case "avgCost":
        return `$${group.avgCostBasis}`;
      case "price":
        return `$${parseFloat(group.player.lastTradePrice || "0").toFixed(2)}`;
      default:
        return `$${group.currentValue}`;
    }
  };

  const getSortLabel = (): string => {
    switch (sortField) {
      case "quantity":
        return "Shares";
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
          const hasStackedShares = group.stacked.length > 0;
          const regularQuantity = group.regular?.quantity || 0;
          const canStackShares = regularQuantity >= 4;
          const effectiveShares = parseFloat(group.totalPower);
          const maxMultiplier =
            group.stacked.length > 0
              ? Math.max(...group.stacked.map((share) => share.multiplier))
              : 0;

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
                      <Zap className="mr-0.5 h-2.5 w-2.5" />
                      {group.totalPower} eff
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
                          ? "text-green-500"
                          : "text-red-500"
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
                  <span>{group.totalShares} shr</span>
                  {lpShares > 0 && <span className="text-blue-400">({lpShares}p)</span>}
                  {hasStackedShares && (
                    <span className="text-purple-400">MULTI {maxMultiplier}x</span>
                  )}
                </div>

                <div className="text-center">
                  {canStackShares ? (
                    <div
                      className="inline-flex items-center gap-1 rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        onStackShares(
                          group.player.id,
                          `${group.player.firstName} ${group.player.lastName}`,
                          regularQuantity,
                        );
                      }}
                    >
                      <Zap className="h-2.5 w-2.5" />
                      Stack
                    </div>
                  ) : (
                    <div className="text-[10px] text-muted-foreground">{regularQuantity}/4+</div>
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
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-purple-500" />
              Multiplier Breakdown
            </DialogTitle>
          </DialogHeader>

          {selectedPlayer && (
            <div className="space-y-4">
              {(() => {
                const regularHolding = selectedPlayer.regular;
                const stackableShares = regularHolding
                  ? Math.floor(regularHolding.quantity / 2) * 2
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
                        <Zap className="mr-1 h-3 w-3" />
                        Eff: {selectedPlayer.totalPower}
                      </Badge>
                    </div>

                    <div className="max-h-[300px] space-y-2 overflow-y-auto">
                      {selectedPlayer.regular && selectedPlayer.regular.quantity > 0 && (
                        <div className="flex items-center justify-between rounded-sm border border-green-500/20 bg-green-500/10 p-3">
                          <div className="flex items-center gap-3">
                            <div className="h-3 w-3 rounded-sm bg-green-500" />
                            <div>
                              <div className="font-medium">Regular Shares</div>
                              <div className="text-sm text-muted-foreground">
                                1x multiplier each
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-mono font-bold">
                              {selectedPlayer.regular.quantity}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {selectedPlayer.regular.quantity} effective shares
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedPlayer.stacked.map((share, index) => (
                        <div
                          key={share.id || index}
                          className={`flex items-center justify-between rounded-sm border border-purple-500/30 p-3 ${getMultiplierTierBg(share.multiplier)}`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`h-3 w-3 rounded-sm ${getMultiplierTierColor(share.multiplier).split(" ")[0]}`}
                            />
                            <div>
                              <div className="font-medium text-purple-700">
                                {share.multiplier}x Stacked Share
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {share.multiplier}x multiplier
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-mono font-bold text-purple-700">
                              {share.quantity}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {share.effectiveShares} effective shares
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {regularHolding && regularHolding.quantity >= 4 && (
                      <Button
                        className="w-full bg-purple-500 hover:bg-purple-600"
                        onClick={() => {
                          onStackShares(
                            selectedPlayer.player.id,
                            `${selectedPlayer.player.firstName} ${selectedPlayer.player.lastName}`,
                            regularHolding.quantity,
                          );
                          setSelectedPlayer(null);
                        }}
                      >
                        <Zap className="mr-2 h-4 w-4" />
                        Stack Shares {stackableShares}
                      </Button>
                    )}

                    <div className="text-center text-xs text-muted-foreground">
                      Minimum 4 shares. Use an even share count. N shares become 1 stacked share at
                      N/2.
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
