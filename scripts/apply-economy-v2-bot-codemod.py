#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

# Bot profile vocabulary: no stack_shares action remains.
path = ROOT / "server/bot/bot-profiles-v2.ts"
text = path.read_text()
text = text.replace('  | "boost_assign"\n  | "stack_shares";', '  | "boost_assign";')
text = text.replace('    "stack_shares",\n', '')
text = re.sub(r'^\s*stack_shares:\s*\d+,?\n', '', text, flags=re.MULTILINE)
path.write_text(text)

# Action executor: remove legacy stack dispatcher/function; use canonical Boost tiers and quantity.
path = ROOT / "server/bot/action-executor.ts"
text = path.read_text()
text = text.replace('      case "stack_shares":\n        return await executeStackShares(botUserId, player, params);\n', '')
text = re.sub(
    r'''\nasync function executeStackShares\([\s\S]*?\n\}\n\n(?=/\*\*)''',
    '\n',
    text,
    count=1,
)
text = text.replace(
    '    case "boost_assign":\n      return { slotTier: Math.floor(Math.random() * 4) + 2 }; // 2-5',
    '    case "boost_assign": {\n      const boostTiers = [2, 3, 5, 7, 10] as const;\n      return {\n        slotTier: boostTiers[Math.floor(Math.random() * boostTiers.length)],\n        shares: Math.max(1, Math.floor(Math.random() * 5) + 1),\n      };\n    }',
)
path.write_text(text)

# Remaining bot selectors/engine should never propose the retired action.
for relative in ["server/bot/player-selector.ts", "server/bot/deterministic-engine.ts"]:
    path = ROOT / relative
    text = path.read_text()
    text = re.sub(r'^.*"stack_shares".*\n', '', text, flags=re.MULTILINE)
    path.write_text(text)

print("Economy V2 bot stacking cleanup applied")
