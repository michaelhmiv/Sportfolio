import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Zap, X } from "lucide-react";
import { PlayerName } from "@/components/player-name";

interface ShareBreakdown {
  quantity: number;
  power: number;
  powerLevel: string;
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
  powered: ShareBreakdown[];
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
  onPowerUp: (playerId: string, playerName: string, availableShares: number) => void;
  onSelectPlayer: (playerId: string) => void;
  sortField: string;
}

export function PortfolioCardView({
  holdings,
  lpPositions,
  onPowerUp,
  onSelectPlayer,
  sortField,
}: PortfolioCardViewProps) {
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerGroup | null>(null);

  const getPowerTierColor = (power: number): string => {
    if (power >= 50) return "bg-purple-600 text-white";
    if (power >= 20) return "bg-purple-500 text-white";
    if (power >= 10) return "bg-purple-400 text-white";
    if (power >= 5) return "bg-purple-300 text-purple-900";
    return "bg-green-500 text-white";
  };

  const getPowerTierBg = (power: number): string => {
    if (power >= 50) return "bg-purple-600/20";
    if (power >= 20) return "bg-purple-500/20";
    if (power >= 10) return "bg-purple-400/20";
    if (power >= 5) return "bg-purple-300/20";
    return "bg-green-500/20";
  };

  const getSortValue = (group: PlayerGroup): string => {
    switch (sortField) {
      case 'quantity':
        return `${group.totalShares} shares`;
      case 'value':
        return `$${group.currentValue}`;
      case 'pnl':
        return `${parseFloat(group.pnl) >= 0 ? '+' : ''}$${group.pnl}`;
      case 'avgCost':
        return `$${group.avgCostBasis}`;
      case 'price':
        return `$${parseFloat(group.player.lastTradePrice || "0").toFixed(2)}`;
      default:
        return `$${group.currentValue}`;
    }
  };

  const getSortLabel = (): string => {
    switch (sortField) {
      case 'quantity':
        return 'Shares';
      case 'value':
        return 'Value';
      case 'pnl':
        return 'P&L';
      case 'avgCost':
        return 'Avg Cost';
      case 'price':
        return 'Price';
      default:
        return 'Value';
    }
  };

  const handlePowerBadgeClick = (e: React.MouseEvent, group: PlayerGroup) => {
    e.stopPropagation();
    setSelectedPlayer(group);
  };

  return (
    <>
      <div className="grid grid-cols-3 gap-2 p-2">
        {/* Player Cards */}
        {holdings.map((group) => {
          const hasPoweredShares = group.powered.length > 0;
          const hasRegularShares = group.regular !== null;
          const regularQuantity = group.regular?.quantity || 0;
          const canBoost = regularQuantity >= 5;
          const totalPowerNum = parseFloat(group.totalPower);

          // Calculate total powered shares
          const totalPoweredShares = group.powered.reduce((sum, share) => sum + share.quantity, 0);
          const maxPower = group.powered.length > 0 
            ? Math.max(...group.powered.map(s => s.power))
            : 0;

          const lpPos = lpPositions?.find((lp) => lp.playerId === group.player.id);
          const lpShares = lpPos ? Math.round(lpPos.equivalentShares || 0) : 0;

          return (
            <Card 
              key={group.player.id} 
              className="hover:shadow-md transition-shadow cursor-pointer border-2 border-border hover:border-primary/50 bg-card"
              onClick={() => onSelectPlayer(group.player.id)}
            >
              <CardContent className="p-2">
                {/* Power Badge - Top Right */}
                <div className="flex justify-end mb-1">
                  {totalPowerNum > 0 ? (
                    <Badge 
                      className={`${getPowerTierColor(totalPowerNum)} text-[10px] px-1 py-0 h-4 cursor-pointer hover:opacity-80`}
                      onClick={(e) => handlePowerBadgeClick(e, group)}
                    >
                      <Zap className="w-2.5 h-2.5 mr-0.5" />
                      {group.totalPower}
                    </Badge>
                  ) : (
                    <div className="h-4" />
                  )}
                </div>

                {/* Main Value - Large */}
                <div className="text-center mb-1">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{getSortLabel()}</div>
                  <div className={`font-mono font-bold text-lg ${
                    sortField === 'pnl' 
                      ? parseFloat(group.pnl) >= 0 ? 'text-green-500' : 'text-red-500'
                      : ''
                  }`}>
                    {getSortValue(group)}
                  </div>
                </div>

                {/* Player Name */}
                <div className="text-center mb-2">
                  <PlayerName
                    playerId={group.player.id}
                    firstName={group.player.firstName}
                    lastName={group.player.lastName}
                    className="font-bold text-sm hover:underline"
                  />
                </div>

                {/* Compact Stats Row */}
                <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground mb-1">
                  <span>{group.totalShares} shr</span>
                  {lpShares > 0 && <span className="text-blue-400">({lpShares}p)</span>}
                  {hasPoweredShares && <span className="text-purple-400">⚡{maxPower}x</span>}
                </div>

                {/* Boost Indicator */}
                {hasRegularShares && (
                  <div className="text-center">
                    {canBoost ? (
                      <div 
                        className="text-[10px] bg-purple-500/10 text-purple-600 rounded px-1.5 py-0.5 inline-flex items-center gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPowerUp(
                            group.player.id,
                            `${group.player.firstName} ${group.player.lastName}`,
                            regularQuantity
                          );
                        }}
                      >
                        <Zap className="w-2.5 h-2.5" />
                        Boost
                      </div>
                    ) : (
                      <div className="text-[10px] text-muted-foreground">
                        {regularQuantity}/5
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Power Distribution Dialog */}
      <Dialog open={!!selectedPlayer} onOpenChange={() => setSelectedPlayer(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-purple-500" />
              Power Distribution
            </DialogTitle>
          </DialogHeader>
          
          {selectedPlayer && (
            <div className="space-y-4">
              {/* Player Info */}
              <div className="flex items-center justify-between pb-3 border-b">
                <div>
                  <PlayerName
                    playerId={selectedPlayer.player.id}
                    firstName={selectedPlayer.player.firstName}
                    lastName={selectedPlayer.player.lastName}
                    className="font-bold text-lg"
                  />
                  <div className="text-sm text-muted-foreground">
                    {selectedPlayer.player.team} • {selectedPlayer.player.position}
                  </div>
                </div>
                <Badge className={`${getPowerTierColor(parseFloat(selectedPlayer.totalPower))} text-sm`}>
                  <Zap className="w-3 h-3 mr-1" />
                  Total: {selectedPlayer.totalPower}
                </Badge>
              </div>

              {/* Share Breakdown List */}
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {/* Regular Shares */}
                {selectedPlayer.regular && selectedPlayer.regular.quantity > 0 && (
                  <div className="flex items-center justify-between p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-green-500" />
                      <div>
                        <div className="font-medium">Regular Shares</div>
                        <div className="text-sm text-muted-foreground">1x power each</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-lg">{selectedPlayer.regular.quantity}</div>
                      <div className="text-sm text-muted-foreground">{selectedPlayer.regular.quantity} power</div>
                    </div>
                  </div>
                )}

                {/* Powered Shares */}
                {selectedPlayer.powered.map((share, idx) => (
                  <div 
                    key={idx}
                    className={`flex items-center justify-between p-3 rounded-lg border ${getPowerTierBg(share.power)} border-purple-500/30`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${getPowerTierColor(share.power).split(' ')[0]}`} />
                      <div>
                        <div className="font-medium text-purple-700">{share.power}x Power Shares</div>
                        <div className="text-sm text-muted-foreground">{share.power}x multiplier</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-lg text-purple-700">{share.quantity}</div>
                      <div className="text-sm text-muted-foreground">{share.powerLevel} power</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Boost Button */}
              {selectedPlayer.regular && selectedPlayer.regular.quantity >= 5 && (
                <Button
                  className="w-full bg-purple-500 hover:bg-purple-600"
                  onClick={() => {
                    onPowerUp(
                      selectedPlayer.player.id,
                      `${selectedPlayer.player.firstName} ${selectedPlayer.lastName}`,
                      selectedPlayer.regular!.quantity
                    );
                    setSelectedPlayer(null);
                  }}
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Power Up {Math.floor(selectedPlayer.regular.quantity / 5) * 5} Shares
                </Button>
              )}

              {/* Info Text */}
              <div className="text-xs text-muted-foreground text-center">
                5 regular shares = 1 powered share with 5x power
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
