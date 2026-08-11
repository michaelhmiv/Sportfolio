#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def rw(rel: str, fn):
    path = ROOT / rel
    text = path.read_text()
    updated = fn(text)
    if updated == text:
        print(f"no-op: {rel}")
    path.write_text(updated)

# Boost UI: use the canonical PlayerName contract and pass a Date to CommunityBoostSelector.
def boosts(text: str) -> str:
    text = text.replace(
        '<PlayerName player={boost.player} fallbackId={boost.playerId} className="font-medium" />',
        '<PlayerName playerId={boost.playerId} firstName={boost.player?.firstName ?? ""} lastName={boost.player?.lastName ?? ""} className="font-medium" />',
    )
    text = text.replace(
        '<PlayerName player={entry.player} fallbackId={entry.playerId} />',
        '<PlayerName playerId={entry.playerId} firstName={entry.player?.firstName ?? ""} lastName={entry.player?.lastName ?? ""} />',
    )
    text = text.replace(
        '<PlayerName player={selectedPlayer.player} fallbackId={selectedPlayer.playerId} className="font-medium" />',
        '<PlayerName playerId={selectedPlayer.playerId} firstName={selectedPlayer.player.firstName} lastName={selectedPlayer.player.lastName} className="font-medium" />',
    )
    text = text.replace(
        '<PlayerName player={entry.player} fallbackId={entry.playerId} className="font-medium" />',
        '<PlayerName playerId={entry.playerId} firstName={entry.player.firstName} lastName={entry.player.lastName} className="font-medium" />',
    )
    text = text.replace('selectedDate={selectedDateKey}', 'selectedDate={selectedDate}')
    return text
rw("client/src/pages/boosts.tsx", boosts)

# Bots: delete every remaining retired stack_shares action from stage selection/fallback/scoring.
def bot_profiles(text: str) -> str:
    return text.replace('["scout_assign", "scout_rebalance", "buy", "stack_shares"]', '["scout_assign", "scout_rebalance", "buy", "boost_assign"]')
rw("server/bot/bot-profiles-v2.ts", bot_profiles)

def deterministic(text: str) -> str:
    text = text.replace('      case "boost_assign":\n      case "stack_shares":\n        return totalAvailableShares >= 1;', '      case "boost_assign":\n        return totalAvailableShares >= 1;')
    text = text.replace('["stack_shares", "buy", "scout_assign", "scout_rebalance"]', '["boost_assign", "buy", "scout_assign", "scout_rebalance"]')
    text = text.replace('        "stack_shares",\n        "pool_create",', '        "boost_assign",\n        "pool_create",')
    # Avoid duplicate boost_assign in steady-state after replacement.
    text = text.replace('        "sell",\n        "boost_assign",\n        "boost_assign",', '        "sell",\n        "boost_assign",')
    return text
rw("server/bot/deterministic-engine.ts", deterministic)

def selector(text: str) -> str:
    text = re.sub(
        r'''\n      if \(context\.actionType === "stack_shares"\) \{\n        // Prefer players with more available shares \(bigger stacks = more multiplier\)\n        score \+= Math\.min\(80, availableShares \* 2\);\n      \}''',
        '',
        text,
        count=1,
    )
    return text
rw("server/bot/player-selector.ts", selector)

# Mobile market: one ownership asset, so the aggregation type cannot require stacked shares.
def mobile(text: str) -> str:
    text = text.replace('  stackedShares: number;\n', '')
    return text
rw("server/market-mobile-overview.ts", mobile)

# Plugin player-market UI: expose only canonical Single quantity/availability and remove all power fields.
def plugin_surface(text: str) -> str:
    text = text.replace(
        '    holding,\n    availableBalance,',
        '    holding,\n    availableShares,\n    availableBalance,',
        1,
    )
    text = text.replace(
        '    userId ? safe(storage.getHolding(userId, "player", playerId), null) : Promise.resolve(null),\n    userId ? safe(storage.getAvailableBalance(userId), 0) : Promise.resolve(0),',
        '    userId ? safe(storage.getHolding(userId, "player", playerId), null) : Promise.resolve(null),\n    userId ? safe(storage.getAvailableShares(userId, "player", playerId), 0) : Promise.resolve(0),\n    userId ? safe(storage.getAvailableBalance(userId), 0) : Promise.resolve(0),',
        1,
    )
    text = text.replace('  const holding = record(holdingState);', '  const holdingRecord = record(holding);')
    old = '''    userHolding: userId
      ? {
          quantity: numberValue(holding.quantity),
          availableShares: numberValue(holding.availableShares),
          effectiveShares: numberValue(holding.effectiveShares),
          multiplier: stringValue(holding.multiplier, "1.0"),
          hasStackedShare: holding.hasStackedShare === true,
          tradeableShares: numberValue(holding.tradeableShares || holding.availableShares),
        }
      : null,'''
    new = '''    userHolding: userId
      ? {
          quantity: numberValue(holdingRecord.quantity),
          availableShares: numberValue(availableShares),
          avgCostBasis: numberValue(holdingRecord.avgCostBasis),
          totalCostBasis: numberValue(holdingRecord.totalCostBasis),
        }
      : null,'''
    if old in text:
        text = text.replace(old, new, 1)
    return text
rw("server/mcp/plugin/ui/surface.ts", plugin_surface)

# REST: simplify every remaining Boost/holding response to Singles-only data.
def routes(text: str) -> str:
    text = text.replace('          multiplier: parseFloat(holding.multiplier) || 0,\n', '')
    start = '''      // Aggregate holdings by playerId to avoid duplicates when user has multiple holding rows
      // (e.g., regular shares + stacked shares for the same player)'''
    end = '''      res.json({
        date: dateStr,'''
    if start in text:
        a = text.index(start)
        b = text.index(end, a)
        replacement = '''      const result = allHoldings
        .filter((holding) => holding.player)
        .map((holding) => {
          const player = holding.player!;
          const teamGame = teamGameMap.get(player.team);
          const quantity = parseFloat(holding.quantity || "0") || 0;
          const totalLocked = lockedQuantities.get(player.id) || 0;
          const availableShares = Math.max(0, quantity - totalLocked);
          const gameStatus = getMarketplaceGameStatus(teamGame);

          return {
            holdingId: holding.id,
            playerId: player.id,
            player,
            sport: player.sport,
            availableShares,
            totalShares: quantity.toFixed(4),
            gameId: teamGame?.gameId || null,
            gameStartTime: teamGame?.startTime || null,
            hasGameToday: Boolean(teamGame),
            gameStatus,
            gameDbStatus: teamGame?.status || "scheduled",
            isAlreadyBoosted: boostedPlayerIds.has(player.id),
            communityBoostCount: communityBoostMap.get(player.id) || 0,
            hasCommunityBoost: communityBoostMap.has(player.id),
            userPremiumShares,
          };
        });

'''
        text = text[:a] + replacement + text[b:]
    text = text.replace('        multiplier: ep.multiplier,\n', '')
    text = text.replace('        hasStackedShare: ep.isStackedShare,\n', '')
    old_live = '''        const parsedShareMultiplier = Number(boost.shareMultiplier ?? 1);
        const effectivePower = Number.isFinite(parsedShareMultiplier) ? parsedShareMultiplier : 1;
        const parsedSlotTier = Number(boost.slotTier ?? 0);
        const slotTierMultiplier = Number.isFinite(parsedSlotTier) ? parsedSlotTier : 0;
        const estimatedPayoutValue = effectivePower * liveFantasyPoints * slotTierMultiplier;
        const estimatedPayout = Number.isFinite(estimatedPayoutValue)
          ? estimatedPayoutValue.toFixed(2)
          : "0.00";'''
    new_live = '''        const estimatedPayout = boost.totalEconomicEarningsSb
          ? Number(boost.totalEconomicEarningsSb).toFixed(2)
          : "0.00";'''
    text = text.replace(old_live, new_live)
    return text
rw("server/routes.ts", routes)

# Discord: Boosts now use direct Singles and the shared validated assignment path; remove /stack entirely.
def discord(text: str) -> str:
    if 'from "../boosts/assign-daily-boost"' not in text:
        text = text.replace(
            'import { hasGameStartedForBoost } from "@shared/game-status";\n',
            'import { hasGameStartedForBoost } from "@shared/game-status";\nimport { assignDailyBoostWithValidation } from "../boosts/assign-daily-boost";\n',
        )
    text = text.replace('return `${p.firstName} ${p.lastName} (${entry.sport}) - ${entry.row.multiplier}x`;', 'return `${p.firstName} ${p.lastName} (${entry.sport}) - ${entry.row.availableShares.toFixed(4)} Singles available`;')
    text = text.replace('    if (![2, 3, 4, 5].includes(slotTier)) {\n      return buildErrorResponse("slot must be one of 2, 3, 4, or 5.");\n    }', '    if (![2, 3, 5, 7, 10].includes(slotTier)) {\n      return buildErrorResponse("slot must be one of 2, 3, 5, 7, or 10.");\n    }')
    text = text.replace('    if (currentBoosts.length >= 4) {\n      return buildErrorResponse("All four boost slots are already filled.");\n    }', '    if (currentBoosts.length >= 5) {\n      return buildErrorResponse("All five boost slots are already filled.");\n    }')
    start = '    const breakdown = await storage.getPlayerShareBreakdown(userId, canonicalPlayerId);'
    end = '    return buildEphemeralResponse(\n      ['
    if start in text:
        a = text.index(start)
        b = text.index(end, a)
        replacement = '''    const shares = Math.min(1, availableShares);
    const { boost } = await assignDailyBoostWithValidation({
      userId,
      playerId: canonicalPlayerId,
      sport,
      slotTier,
      shares,
      etDate: dateStr,
    });

'''
        text = text[:a] + replacement + text[b:]
    text = text.replace('        `Share source: ${shareSourceType}`,\n        `Share multiplier: ${shareMultiplier}x`,\n', '        `Singles committed: 1`,\n')
    text = text.replace('    case "stack":\n      return handleStack(ctx, options);\n', '')
    return text
rw("server/routes/discord.ts", discord)

print("Economy V2 compile cleanup finalized")
