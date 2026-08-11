#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "server/storage.ts"
text = PATH.read_text()


def remove_between(source: str, start: str, end: str) -> str:
    if start not in source:
        return source
    a = source.index(start)
    b = source.index(end, a)
    return source[:a] + source[b:]


def replace_method(source: str, signature: str, next_signature: str, replacement: str) -> str:
    if signature not in source:
        return source
    a = source.index(signature)
    b = source.index(next_signature, a)
    return source[:a] + replacement.rstrip() + "\n\n" + source[b:]


# Holdings are Singles only. Keep effectiveShares as a compatibility name for generic holdings consumers,
# but remove all multiplier/stack semantics and fields.
text = re.sub(
    r'''export interface HoldingSummary extends Holding \{[\s\S]*?\n\}\n\nexport interface HoldingWithPlayerSummary''',
    '''export interface HoldingSummary extends Holding {\n  effectiveShares: string;\n}\n\nexport interface HoldingWithPlayerSummary''',
    text,
    count=1,
)
text = re.sub(r'''\nexport interface HoldingMultiplierState \{[\s\S]*?\n\}\n''', "\n", text, count=1)
text = re.sub(
    r'''function buildHoldingSummary\(holding: Holding\): HoldingSummary \{[\s\S]*?\n\}\n\nfunction buildStackedShareSummary[\s\S]*?\n\}\n''',
    '''function buildHoldingSummary(holding: Holding): HoldingSummary {\n  return { ...holding, effectiveShares: holding.quantity };\n}\n''',
    text,
    count=1,
)
text = text.replace('  "stacking",\n', '')

# Remove retired holdings interface methods. Community shares remain a separate asset and are preserved.
text = re.sub(
    r'''  getPlayerShareBreakdown\([\s\S]*?\): Promise<\{ regular: Holding \| null; stacked: HoldingSummary\[\] \}>;\n''',
    "",
    text,
    count=1,
)
text = text.replace("  getTotalEffectiveShares(userId: string, playerId: string): Promise<number>;\n", "")
# Remove any multiplier-state interface method left elsewhere.
text = re.sub(r'''  getHoldingMultiplierState\([\s\S]*?\): Promise<HoldingMultiplierState>;\n''', "", text, count=1)

# Private multiplier query helpers are gone; keep the next regular-share availability helper.
text = remove_between(text, "  private async getPlayerMultiplier(", "  private async getRegularAvailableShares(")

# User holdings: a single canonical row per user/player.
text = replace_method(
    text,
    "  async getUserHoldings(userId: string): Promise<HoldingSummary[]> {",
    "  // Batched version:",
    '''  async getUserHoldings(userId: string): Promise<HoldingSummary[]> {\n    const baseHoldings = await db.select().from(holdings).where(eq(holdings.userId, userId));\n    return baseHoldings.map(buildHoldingSummary);\n  }''',
)

text = replace_method(
    text,
    "  async getUserHoldingsWithPlayers(userId: string): Promise<any[]> {",
    "  async updateHolding(",
    '''  async getUserHoldingsWithPlayers(userId: string): Promise<any[]> {\n    const holdingRows = await db\n      .select({\n        holding: holdings,\n        player: players,\n        totalLocked: sql<number>`COALESCE(SUM(${holdingsLocks.lockedQuantity}), 0)`,\n      })\n      .from(holdings)\n      .leftJoin(players, and(eq(holdings.assetType, "player"), eq(holdings.assetId, players.id)))\n      .leftJoin(\n        holdingsLocks,\n        and(\n          eq(holdingsLocks.userId, holdings.userId),\n          eq(holdingsLocks.assetId, holdings.assetId),\n          eq(holdingsLocks.assetType, holdings.assetType),\n        ),\n      )\n      .where(eq(holdings.userId, userId))\n      .groupBy(holdings.id, players.id);\n\n    return holdingRows.map((row) => ({\n      ...row,\n      holding: buildHoldingSummary(row.holding),\n    }));\n  }''',
)

# Remove any remaining old share-breakdown/effective-share/multiplier-state implementation blocks.
for signature, next_signature in [
    ("  async getPlayerShareBreakdown(", "  async getBatchSentiment("),
    ("  async getTotalEffectiveShares(", "  async getUserCommunityBoostShares("),
    ("  async getHoldingMultiplierState(", "  // AMM / LP Methods"),
]:
    if signature in text and next_signature in text[text.index(signature):]:
        text = remove_between(text, signature, next_signature)

# Restore Community Boost inventory as an ordinary community holding; this feature is independent of Stack.
community_method = '''  async getUserCommunityBoostShares(userId: string): Promise<number> {\n    const [row] = await db\n      .select({ total: sql<string>`COALESCE(SUM(CAST(${holdings.quantity} AS NUMERIC)), 0)` })\n      .from(holdings)\n      .where(and(eq(holdings.userId, userId), eq(holdings.assetType, "community")));\n    return toHoldingNumber(row?.total);\n  }'''
if "async getUserCommunityBoostShares" not in text:
    marker = "  // Batch sentiment logic"
    if marker not in text:
        raise RuntimeError("Could not restore community shares: marker missing")
    text = text.replace(marker, community_method + "\n\n" + marker, 1)

# Economy supply statistics now count only Singles and actual burned quantity.
text = re.sub(
    r'''    const totalHoldingsResult: any = await db\.execute\(sql`[\s\S]*?`\);\n    const totalHoldingsRows = totalHoldingsResult\?\.rows \?\? totalHoldingsResult;\n    const totalSharesInEconomy = parseInt\(totalHoldingsRows\[0\]\?\.total \|\| "0"\);''',
    '''    const [totalHoldingsResult] = await db\n      .select({ total: sql<string>`COALESCE(SUM(CAST(${holdings.quantity} AS NUMERIC)), 0)` })\n      .from(holdings)\n      .where(and(eq(holdings.assetType, "player"), gt(holdings.quantity, "0")));\n    const totalSharesInEconomy = Math.floor(toHoldingNumber(totalHoldingsResult?.total));''',
    text,
    count=1,
)
text = text.replace("SUM(${dailyBoosts.sharesEntered})", "SUM(${dailyBoosts.sharesBurned})")

# All holdings with players is Singles only.
text = replace_method(
    text,
    "  async getAllHoldingsWithPlayers(userId: string): Promise<HoldingWithPlayerSummary[]> {",
    "  async getEligiblePlayersForBoost(",
    '''  async getAllHoldingsWithPlayers(userId: string): Promise<HoldingWithPlayerSummary[]> {\n    const rows = await db\n      .select()\n      .from(holdings)\n      .innerJoin(players, eq(holdings.assetId, players.id))\n      .where(and(eq(holdings.userId, userId), eq(holdings.assetType, "player")));\n\n    return rows.map((row) => ({\n      ...buildHoldingSummary(row.holdings),\n      player: row.players,\n    }));\n  }''',
)

# Boost eligibility uses only regular Singles; remove multiplier query and synthetic loop.
if "  async getEligiblePlayersForBoost(" in text:
    a = text.index("  async getEligiblePlayersForBoost(")
    b = text.index("  async createDailyBoost(", a)
    method = text[a:b]
    method = method.replace(
        '''    const [regularHoldings, multiplierRows] = await Promise.all([\n      db\n        .select()\n        .from(holdings)\n        .innerJoin(players, eq(holdings.assetId, players.id))\n        .where(\n          and(\n            eq(holdings.userId, userId),\n            eq(holdings.assetType, "player"),\n            eq(players.sport, sport),\n          ),\n        ),\n      db\n        .select({\n          multiplier: playerMultipliers,\n          player: players,\n        })\n        .from(playerMultipliers)\n        .innerJoin(players, eq(playerMultipliers.playerId, players.id))\n        .where(and(eq(playerMultipliers.userId, userId), eq(players.sport, sport))),\n    ]);''',
        '''    const regularHoldings = await db\n      .select()\n      .from(holdings)\n      .innerJoin(players, eq(holdings.assetId, players.id))\n      .where(\n        and(\n          eq(holdings.userId, userId),\n          eq(holdings.assetType, "player"),\n          eq(players.sport, sport),\n        ),\n      );''',
    )
    method = re.sub(r'''\n    for \(const row of multiplierRows\) \{[\s\S]*?\n    \}\n\n    return result;''', "\n    return result;", method, count=1)
    text = text[:a] + method + text[b:]

# Any residual playerMultipliers query is a retired dependency and should make this codemod fail loudly.
if "playerMultipliers" in text or "PlayerMultiplier" in text:
    # Print nearby lines in CI before failing so the next pass is deterministic.
    lines = text.splitlines()
    hits = [f"{i+1}: {line}" for i, line in enumerate(lines) if "playerMultiplier" in line or "PlayerMultiplier" in line]
    raise RuntimeError("Residual Stack multiplier references in storage:\n" + "\n".join(hits[:40]))

# Activity metadata already has generic `shares`; use that rather than introducing a V2-only field.
text = text.replace("sharesEntered: boost.sharesEntered,", "shares: toHoldingNumber(boost.sharesEntered),")

PATH.write_text(text)
print("Economy V2 Singles-only storage cleanup applied")
