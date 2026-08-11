#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def edit(rel, fn):
    p = ROOT / rel
    text = p.read_text()
    new = fn(text)
    if new != text:
        p.write_text(new)

# Remove the retired activity category everywhere it still appears.
edit("client/src/components/portfolio-activity-tab.helpers.ts", lambda t: t.replace('  "stacking",\n', ''))

def clean_activity_tab(t):
    t = t.replace('  Database,\n', '')
    t = re.sub(r'^\s*\{ value: "stacking", label: "Stacking" \},\n', '', t, flags=re.M)
    t = re.sub(r'^\s*stacking: "Stacking",\n', '', t, flags=re.M)
    t = re.sub(r'\s*case "stacking":\n\s*return Database;\n', '\n', t)
    t = re.sub(r'\s*case "stacking":\n\s*return "border-category-stacking/20 bg-category-stacking/10 text-category-stacking";\n', '\n', t)
    return t
edit("client/src/components/portfolio-activity-tab.tsx", clean_activity_tab)

# Deleted legacy payout helper must have no import or calls remaining. Direct Singles quantity is the V2 earning unit.
def clean_routes(t):
    t = t.replace('import { getPerformanceEarningUnits } from "./lib/performance-earnings";\n', '')
    t = t.replace('return getPerformanceEarningUnits(holding) > 0;', 'return parseLiveEarningsNumber(holding.quantity) > 0;')
    t = t.replace('const effectiveShares = getPerformanceEarningUnits(holding);', 'const effectiveShares = quantity;')
    return t
edit("server/routes.ts", clean_routes)

# Discord portfolio is Singles-only. Remove retired view/stack vocabulary rather than emulate it.
def clean_discord_routes(t):
    t = t.replace('  normalizePortfolioView,\n', '')
    t = re.sub(r'^\s*"`/portfolio sport:MLB view:stacked`",\n', '', t, flags=re.M)
    t = re.sub(r'^\s*"`/stack player:<name> amount:50%`",\n', '', t, flags=re.M)
    t = re.sub(r'\n\s*const view = normalizePortfolioView\(getStringOption\(options, "view"\)\);\n\s*if \(!view\) \{\n\s*return buildErrorResponse\("Invalid view filter\. Use one of: all, stacked, regular\."\);\n\s*\}\n', '\n', t)
    t = re.sub(r'\n\s*\.filter\(\(item: any\) => \{\n\s*if \(view === "stacked"\) return isStacked;\n\s*if \(view === "regular"\) return !isStacked;\n\s*return true;\n\s*\}\)', '', t)
    t = re.sub(r'\n\s*if \(view === "stacked"\)[^\n]*\n', '\n', t)
    t = re.sub(r'\n\s*if \(view === "regular"\)[^\n]*\n', '\n', t)
    return t
edit("server/routes/discord.ts", clean_discord_routes)

# The utility no longer needs a portfolio view concept or an even-share stacking amount mode.
def clean_discord_utils(t):
    t = re.sub(r'^export type DiscordPortfolioView = .*\n', '', t, flags=re.M)
    t = t.replace('export type ResolvedAmountKind = "currency" | "whole" | "evenWhole";\n', 'export type ResolvedAmountKind = "currency" | "whole";\n')
    t = re.sub(r'\nexport function normalizePortfolioView\([\s\S]*?\n\}\n\nexport function parseAmountInput', '\nexport function parseAmountInput', t, count=1)
    t = t.replace('  } else {\n    const floored = Math.floor(resolvedRaw);\n    resolvedValue = floored - (floored % 2);\n  }\n', '  } else {\n    resolvedValue = Math.floor(resolvedRaw);\n  }\n')
    return t
edit("server/discord-command-utils.ts", clean_discord_utils)

print("Economy V2 dangling cleanup applied")
