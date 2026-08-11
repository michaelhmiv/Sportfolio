#!/usr/bin/env python3
from pathlib import Path
import re

path = Path(__file__).resolve().parents[1] / "server/storage.ts"
text = path.read_text()

# The Singles-only storage codemod intentionally preserves this interface contract, but an earlier
# insertion marker could place the implementation directly below it. Keep only the declaration here.
text = re.sub(
    r'''  getUserCommunityBoostShares\(userId: string\): Promise<number>;\n\n  async getUserCommunityBoostShares\(userId: string\): Promise<number> \{[\s\S]*?\n  \}\n''',
    '''  getUserCommunityBoostShares(userId: string): Promise<number>;\n''',
    text,
    count=1,
)

class_start = text.find("export class DatabaseStorage")
if class_start < 0:
    raise RuntimeError("DatabaseStorage class not found")
class_text = text[class_start:]
if "async getUserCommunityBoostShares" not in class_text:
    marker = "  async getCommunityBoostCountForPlayerIdentity("
    marker_index = text.find(marker, class_start)
    if marker_index < 0:
        # Fall back to the daily-boost method cluster.
        marker = "  async getCommunityBoostsAllSports("
        marker_index = text.find(marker, class_start)
    if marker_index < 0:
        raise RuntimeError("Could not find Community Boost implementation marker")
    method = '''  async getUserCommunityBoostShares(userId: string): Promise<number> {\n    const [row] = await db\n      .select({ total: sql<string>`COALESCE(SUM(CAST(${holdings.quantity} AS NUMERIC)), 0)` })\n      .from(holdings)\n      .where(and(eq(holdings.userId, userId), eq(holdings.assetType, "community")));\n    return toHoldingNumber(row?.total);\n  }\n\n'''
    text = text[:marker_index] + method + text[marker_index:]

path.write_text(text)
print("Community Boost storage method placed in DatabaseStorage")
