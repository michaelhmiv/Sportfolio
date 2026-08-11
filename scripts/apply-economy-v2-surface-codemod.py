#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def rw(rel, fn):
    path = ROOT / rel
    text = path.read_text()
    updated = fn(text)
    path.write_text(updated)


# Mobile market holding context: only liquid Singles exist.
def market_mobile(text: str) -> str:
    text = text.replace("      regularShares: 0,\n      stackedShares: 0,\n      bestShareMultiplier: 1,", "      regularShares: 0,\n      bestShareMultiplier: 1,")
    text = text.replace('    const multiplier = toNumber(holding.multiplier || "1");\n\n    if (holding.isStackedShare) {\n      current.stackedShares += quantity;\n    } else {\n      current.regularShares += quantity;\n    }\n\n    current.bestShareMultiplier = Math.max(\n      current.bestShareMultiplier,\n      holding.isStackedShare && quantity >= 1 ? multiplier : 1,\n    );', '    current.regularShares += quantity;\n    current.bestShareMultiplier = 1;')
    text = text.replace("      availableShares: availableRegularShares + context.stackedShares,", "      availableShares: availableRegularShares,")
    return text
rw("server/market-mobile-overview.ts", market_mobile)

# Native MCP: get_player_shares_info returns Singles-only holding/market data; multiplier-state tool is retired.
def native_ops(text: str) -> str:
    text = text.replace(
        '''      const [market, availableShares, breakdown] = await Promise.all([\n        getCanonicalPlayerMarket(playerId),\n        storage.getAvailableShares(input.userId, "player", playerId),\n        storage.getPlayerShareBreakdown(input.userId, playerId),\n      ]);''',
        '''      const [market, availableShares, holding] = await Promise.all([\n        getCanonicalPlayerMarket(playerId),\n        storage.getAvailableShares(input.userId, "player", playerId),\n        storage.getHolding(input.userId, "player", playerId),\n      ]);''',
    )
    text = text.replace("        breakdown,", "        holding: holding ? { quantity: holding.quantity, avgCostBasis: holding.avgCostBasis, totalCostBasis: holding.totalCostBasis } : null,")
    text = re.sub(r'''\n    case "get_holding_multiplier_state": \{[\s\S]*?\n    \}''', "", text, count=1)
    return text
rw("server/mcp/native-operations.ts", native_ops)

# ChatGPT UI server: replace multiplier-state reads with ordinary holding + availability; remove Stack fields.
def plugin_surface(text: str) -> str:
    text = text.replace("    holdingState,", "    holding,")
    text = text.replace(
        '''    userId\n      ? safe(storage.getHoldingMultiplierState(userId, playerId), null)\n      : Promise.resolve(null),''',
        '''    userId ? safe(storage.getHolding(userId, "player", playerId), null) : Promise.resolve(null),''',
    )
    # If exact escaped replacement did not hit, use literal source fragment.
    text = text.replace(
        '''    userId
      ? safe(storage.getHoldingMultiplierState(userId, playerId), null)
      : Promise.resolve(null),''',
        '''    userId ? safe(storage.getHolding(userId, "player", playerId), null) : Promise.resolve(null),''',
    )
    text = text.replace("        stackPower: position.stackPower,\n", "")
    text = text.replace("        gameplayPower: position.gameplayPower,\n", "")
    text = text.replace("    safe(storage.getHoldingMultiplierState(userId, playerId), null),", "    safe(storage.getHolding(userId, \"player\", playerId), null),")
    text = text.replace("  const holdingRecord = record(holding);", "  const holdingRecord = record(holding);")
    # Player market holding output may still mention multiplier state; map it to Singles only.
    text = text.replace("holding: holdingState,", "holding: holding ? { quantity: holding.quantity, avgCostBasis: holding.avgCostBasis, totalCostBasis: holding.totalCostBasis } : null,")
    return text
rw("server/mcp/plugin/ui/surface.ts", plugin_surface)

# Dashboard/REST/game context: intrinsic share multiplier is gone; all holdings are 1x Singles.
def routes(text: str) -> str:
    text = text.replace("boostSlotsRemaining = Math.max(0, 4 - currentBoosts.length);", "boostSlotsRemaining = Math.max(0, 5 - currentBoosts.length);")
    text = text.replace('parseFloat(b.multiplier || "0") - parseFloat(a.multiplier || "0")', "0")
    text = text.replace('multiplier: parseFloat(player.multiplier || "0"),', "multiplier: 1,")
    text = text.replace('const multiplier = parseFloat(player.multiplier || "0");', "const multiplier = 1;")
    text = text.replace('multiplier: parseFloat(holding.multiplier || "0"),', "multiplier: 1,")
    text = text.replace("effectiveShares: position.gameplayPower.toFixed(2),", "effectiveShares: position.singles.toFixed(2),")
    text = text.replace("        stackPower: position.stackPower,\n", "")
    text = text.replace("        gameplayPower: position.gameplayPower,\n", "")
    text = text.replace("          shareMultiplier: boost.shareMultiplier,\n", "")
    return text
rw("server/routes.ts", routes)

# Discord: remove Stack command path and old share-multiplier shaping; direct boost defaults to one Single.
def discord(text: str) -> str:
    text = text.replace('      case "stack":\n      case "stack_shares":\n        return await handleStackSharesInteraction(req, res, interaction);\n', '')
    text = re.sub(r'''\nasync function handleStackSharesInteraction\([\s\S]*?(?=\nasync function handle)''', "\n", text, count=1)
    text = text.replace("boost.shareMultiplier", "boost.sharesEntered")
    text = text.replace("sharesEntered: 1,", 'sharesEntered: "1",')
    text = text.replace("shareMultiplier: boost.shareMultiplier,", "sharesEntered: boost.sharesEntered,")
    return text
rw("server/routes/discord.ts", discord)

# Public MCP registry: remove old multiplier-state read tool if it survived; direct boost schema includes quantity.
def registry(text: str) -> str:
    text = re.sub(r'''\n  \{\n    name: "get_holding_multiplier_state",[\s\S]*?\n  \},(?=\n  \{)''', "", text, count=1)
    # stage_daily_boost_assign input schema: add shares if absent.
    marker = 'name: "stage_daily_boost_assign"'
    idx = text.find(marker)
    if idx >= 0:
        window_end = text.find("fixtureArgs:", idx)
        segment = text[idx:window_end]
        if "shares:" not in segment:
            segment = segment.replace(
                'slotTier: z.number().int(),',
                'slotTier: z.number().int().refine((value) => [2, 3, 5, 7, 10].includes(value), "Use 2x, 3x, 5x, 7x, or 10x"),\n      shares: z.number().positive(),',
            )
            text = text[:idx] + segment + text[window_end:]
        # update fixture if needed
        fixture_end = text.find("execute:", idx)
        fixture_seg = text[window_end:fixture_end]
        if "shares:" not in fixture_seg:
            fixture_seg = fixture_seg.replace("slotTier: 2,", "slotTier: 2,\n        shares: 1,")
            text = text[:window_end] + fixture_seg + text[fixture_end:]
    return text
rw("server/mcp/public-tool-registry.ts", registry)

print("Economy V2 surface cleanup applied")
