#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def load(path):
    return (ROOT / path).read_text()


def save(path, text):
    (ROOT / path).write_text(text)


def remove_between(text, start, end):
    if start not in text:
        return text
    a = text.index(start)
    try:
        b = text.index(end, a)
    except ValueError:
        return text
    return text[:a] + text[b:]


# --- storage: delete old Stack mechanics and retired payout implementation ---
path = "server/storage.ts"
text = load(path)
for token in [
    "  playerMultipliers,\n",
    "  playerMultiplierEvents,\n",
    "  type PlayerMultiplier,\n",
    "  type InsertPlayerMultiplierEvent,\n",
]:
    text = text.replace(token, "")
# Interface Stack contract sits before the Daily Boost contract.
text = remove_between(text, "  // Multiplier / Stack Shares methods", "  // AMM / LP methods")
# Implementation Stack contract runs through the old multiplier-state helper and ends at AMM/LP.
text = remove_between(text, "  // Stack Shares methods", "  // AMM / LP Methods")
# Interface contracts for old payout/lock helpers.
text = re.sub(
    r'''  createSharePayoutSnapshotsForGame\([\s\S]*?\): Promise<number>;\n''',
    "",
    text,
    count=1,
)
text = re.sub(
    r'''  processSharePayoutCredit\([\s\S]*?\): Promise<boolean>;\n''',
    "",
    text,
    count=1,
)
text = text.replace("  lockBoostShares(boostId: string): Promise<void>;\n", "")
# Activity feed: stacking category is retired completely.
text = remove_between(text, '    if (typeSet.has("stacking")) {', '    if (typeSet.has("boosts")) {')
# Direct Boost activity fields.
text = text.replace(
    "                shareMultiplier: dailyBoosts.shareMultiplier,\n",
    "                sharesEntered: dailyBoosts.sharesEntered,\n",
)
text = text.replace("                shareSourceType: dailyBoosts.shareSourceType,\n", "")
text = re.sub(
    r'''            const sourceLabel =\n              boost\.shareSourceType === "stacked"\n                \? `\$\{toHoldingNumber\(boost\.shareMultiplier\)\.toFixed\(2\)\}x stacked share`\n                : "single share";''',
    '            const sourceLabel = `${toHoldingNumber(boost.sharesEntered).toFixed(4)} Singles`;',
    text,
)
text = text.replace("                shareSourceType: boost.shareSourceType,\n", "                sharesEntered: boost.sharesEntered,\n")
# Delete the old SQL Stack-only snapshot method while preserving getPendingSharePayouts.
text = remove_between(text, "  async createSharePayoutSnapshotsForGame(", "  async getPendingSharePayouts(")
# Delete retired individual-credit and Stack/regular burn implementation. Economy repository owns both.
text = remove_between(text, "  async processSharePayoutCredit(", "  async unlockBoostShares(")
save(path, text)

# --- canonical valuation: one asset only, Singles ---
path = "server/valuation/canonical-valuation.ts"
text = load(path)
text = text.replace("  playerMultipliers,\n", "")
for line in [
    "  stackId: string | null;\n",
    "  stackPower: number;\n",
    "  gameplayPower: number;\n",
    "  totalStackPower: number;\n",
    "  totalGameplayPower: number;\n",
    '  | "totalStackPower"\n',
    '  | "totalGameplayPower"\n',
]:
    text = text.replace(line, "")
text = re.sub(r'''\ntype MultiplierLike = \{[\s\S]*?\};\n''', "\n", text, count=1)
text = text.replace("    totalStackPower: valuation.totalStackPower,\n", "")
text = text.replace("    totalGameplayPower: valuation.totalGameplayPower,\n", "")
text = text.replace("  multipliers: MultiplierLike[];\n", "")
text = text.replace(
    '''    { holding?: HoldingLike; multiplier?: MultiplierLike; player: PlayerLike }\n''',
    '''    { holding?: HoldingLike; player: PlayerLike }\n''',
)
text = re.sub(
    r'''\n  for \(const multiplier of input\.multipliers\) \{[\s\S]*?\n  \}\n\n  const positions:''',
    "\n\n  const positions:",
    text,
    count=1,
)
text = text.replace("    const stackPower = Math.max(0, finite(row.multiplier?.multiplier));\n", "")
text = text.replace("      stackId: row.multiplier?.id || null,\n", "")
text = text.replace("      stackPower,\n", "")
text = text.replace("      gameplayPower: singles + stackPower,\n", "")
text = re.sub(r'''\n    totalStackPower: positions\.reduce\([\s\S]*?\),''', "", text, count=1)
text = re.sub(r'''\n    totalGameplayPower: positions\.reduce\([\s\S]*?\),''', "", text, count=1)
old_query = '''    db\n      .select({\n        id: playerMultipliers.id,\n        playerId: playerMultipliers.playerId,\n        multiplier: playerMultipliers.multiplier,\n        player: players,\n      })\n      .from(playerMultipliers)\n      .innerJoin(players, eq(playerMultipliers.playerId, players.id))\n      .where(eq(playerMultipliers.userId, userId)),\n'''
text = text.replace(
    "  const [userRows, holdingRows, multiplierRows, lpRows] = await Promise.all([",
    "  const [userRows, holdingRows, lpRows] = await Promise.all([",
)
text = text.replace(old_query, "")
text = text.replace("    ...multiplierRows.map((row) => row.playerId),\n", "")
text = text.replace("    multipliers: multiplierRows,\n", "")
save(path, text)

# --- MCP transaction copy and public registry ---
path = "server/mcp/gameplay-transactions.ts"
text = load(path)
text = text.replace(
    '    case "holdings_stack_shares":\n      return `Stack ${action.sharesToStack} shares of ${await playerLabel(action.playerId)}.`;\n',
    "",
)
text = text.replace(
    '      return `Assign ${await playerLabel(action.playerId)} to the ${action.slotTier}x daily boost slot for ${action.boostDate}.`;\n',
    '      return `Commit ${action.shares} Singles of ${await playerLabel(action.playerId)} to the ${action.slotTier}x daily boost slot for ${action.boostDate}; the shares burn when the game begins.`;\n',
)
save(path, text)

path = "server/mcp/public-tool-registry.ts"
text = load(path)
text = text.replace(
    '    case "preview_stack_shares":\n      return { actionType: "holdings_stack_shares", playerId, sharesToStack: Number(args.shares) };\n',
    "",
)
text = text.replace(
    "        slotTier: Number(args.slotTier) as 2 | 3 | 4 | 5,\n",
    "        slotTier: Number(args.slotTier) as 2 | 3 | 5 | 7 | 10,\n        shares: Number(args.shares),\n",
)
text = re.sub(
    r'''\n  \{\n    name: "stage_stack_shares",[\s\S]*?\n  \},(?=\n  \{\n    name: "stage_daily_boost_assign")''',
    "",
    text,
    count=1,
)
save(path, text)

# --- REST: delete Stack routes entirely and remove obsolete Boost response field ---
path = "server/routes.ts"
text = load(path)
text = text.replace('import { buildStackSharesResponsePayload } from "./lib/stack-shares-response";\n', "")
text = remove_between(
    text,
    "  // ============================================\n  // STACK SHARES ROUTES",
    "  // ============================================\n  // DAILY BOOSTS ROUTES",
)
text = text.replace("          shareMultiplier: boost.shareMultiplier,\n", "")
save(path, text)

# --- Discord: retire command and report direct share quantity ---
path = "server/routes/discord.ts"
text = load(path)
text = re.sub(r'''\nasync function handleStack[\s\S]*?(?=\nasync function )''', "\n", text, count=1)
text = text.replace("boost.shareMultiplier", "boost.sharesEntered")
text = text.replace("sharesEntered: 1,", 'sharesEntered: "1",')
save(path, text)

print("Economy V2 dependency cleanup applied")
