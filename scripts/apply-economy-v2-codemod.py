#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text)


def replace_required(text: str, old: str, new: str, label: str) -> str:
    if old in text:
        return text.replace(old, new, 1)
    if new in text:
        return text
    raise RuntimeError(f"Could not find expected fragment for {label}")


# Bot: direct Singles, valid five-slot tiers, no Stack source metadata.
path = "server/bot/action-executor.ts"
text = read(path)
old = '''  const slotTier = params.slotTier || 4;\n\n  try {\n    const { shareMultiplier, shareSourceType } = await assignDailyBoostWithValidation({\n      userId: botUserId,\n      playerId: player.playerId,\n      slotTier,\n      sport: player.sport,\n      etDate: new Date(),\n    });\n\n    return {\n      actionType: "boost_assign",\n      playerId: player.playerId,\n      playerName: player.playerName,\n      success: true,\n      details: {\n        slotTier,\n        shareMultiplier,\n        shareSourceType,\n      },\n    };'''
new = '''  const requestedTier = params.slotTier || 5;\n  const slotTier = [2, 3, 5, 7, 10].includes(requestedTier) ? requestedTier : 5;\n  const shares = Math.max(0.0001, params.shares || 1);\n\n  try {\n    const result = await assignDailyBoostWithValidation({\n      userId: botUserId,\n      playerId: player.playerId,\n      slotTier,\n      shares,\n      sport: player.sport,\n      etDate: new Date(),\n    });\n\n    return {\n      actionType: "boost_assign",\n      playerId: player.playerId,\n      playerName: player.playerName,\n      success: true,\n      details: {\n        slotTier,\n        sharesCommitted: result.sharesCommitted,\n      },\n    };'''
text = replace_required(text, old, new, "bot boost caller")
write(path, text)

# MCP transaction domain: retire stack action and make Boost quantity explicit.
path = "server/mcp/gameplay-transactions.ts"
text = read(path)
text = text.replace('  | { actionType: "holdings_stack_shares"; playerId: string; sharesToStack: number }\n', '')
text = text.replace('      slotTier: 2 | 3 | 4 | 5;\n      boostDate: string;', '      slotTier: 2 | 3 | 5 | 7 | 10;\n      shares: number;\n      boostDate: string;')
text = re.sub(
    r'''\n    case "holdings_stack_shares":\n      if \(\n        !Number\.isInteger\(action\.sharesToStack\) \|\|\n        action\.sharesToStack < 4 \|\|\n        action\.sharesToStack % 2 !== 0\n      \) \{\n        throw new Error\("sharesToStack must be an even integer of at least 4"\);\n      \}\n      break;''',
    '',
    text,
)
text = re.sub(
    r'''\n    case "holdings_stack_shares": \{\n      const result = await storage\.stackShares\(userId, action\.playerId, action\.sharesToStack\);\n      return withPlayer\(result, action\.playerId\);\n    \}''',
    '',
    text,
)
text = replace_required(
    text,
    '''        slotTier: action.slotTier,\n        etDate: action.boostDate,''',
    '''        slotTier: action.slotTier,\n        shares: action.shares,\n        etDate: action.boostDate,''',
    "MCP boost execution quantity",
)
# Validate direct Boost inputs centrally in staged actions.
needle = '''    case "pool_remove_liquidity":\n      assertPositive(action.lpShares, "lpShares");\n      break;'''
replacement = needle + '''\n    case "daily_boost_assign":\n      assertPositive(action.shares, "shares");\n      if (![2, 3, 5, 7, 10].includes(action.slotTier)) {\n        throw new Error("slotTier must be one of 2, 3, 5, 7, or 10");\n      }\n      break;'''
text = replace_required(text, needle, replacement, "MCP boost validation")
write(path, text)

# REST direct-share Boost assignment.
path = "server/routes.ts"
text = read(path)
text = text.replace('if (![2, 3, 4, 5].includes(tierNum)) {\n        return res.status(400).json({ error: "slotTier must be 2, 3, 4, or 5" });\n      }', 'if (![2, 3, 5, 7, 10].includes(tierNum)) {\n        return res.status(400).json({ error: "slotTier must be 2, 3, 5, 7, or 10" });\n      }')
text = text.replace('const shares = parseInt(sharesEntered);', 'const shares = Number(sharesEntered);')
text = re.sub(
    r'''\n      // Verify only 1 share is entered per boost slot\.\n      if \(shares !== 1\) \{\n        return res\.status\(400\)\.json\(\{\n          error: `Only 1 share can be placed in a boost slot\. You entered \$\{shares\} shares\. Use Stack Shares to roll more multiplier into a single share\.`,\n        \}\);\n      \}\n''',
    '\n',
    text,
)
text = replace_required(
    text,
    '''      const { boost, canonicalPlayerId, shareMultiplier } = await assignDailyBoostWithValidation({\n        userId,\n        playerId,\n        sport,\n        slotTier: tierNum,\n        etDate: dateStr,\n      });''',
    '''      const { boost, canonicalPlayerId, sharesCommitted } = await assignDailyBoostWithValidation({\n        userId,\n        playerId,\n        sport,\n        slotTier: tierNum,\n        shares,\n        etDate: dateStr,\n      });''',
    "REST boost caller",
)
text = text.replace('          shareMultiplier,', '          sharesCommitted: sharesCommitted.toFixed(4),')
write(path, text)

print("Economy V2 codemod applied")
