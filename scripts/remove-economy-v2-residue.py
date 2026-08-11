#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(rel):
    return (ROOT / rel).read_text()


def write(rel, text):
    (ROOT / rel).write_text(text)


def delete(rel):
    path = ROOT / rel
    if path.exists():
        path.unlink()


# Files whose sole purpose was the retired condensed-share economy.
for rel in [
    "client/src/components/portfolio-card-view.tsx",
    "client/src/components/boost/live-fantasy-points.tsx",
    "client/src/components/ceremonies/boost-results-podium.tsx",
    "client/src/features/boosts/assign-boost-feedback.ts",
    "client/src/features/boosts/assign-boost-feedback.test.ts",
    "server/lib/performance-earnings.ts",
    "server/lib/performance-earnings.test.ts",
    "server/storage.share-payouts.test.ts",
    "server/holding-lock-concurrency.contract.test.ts",
]:
    delete(rel)

# Shared activity vocabulary: one player asset, no legacy stacking activity category/source metadata.
rel = "shared/activity-feed.ts"
text = read(rel)
text = text.replace('  "stacking",\n', "")
text = text.replace("  shareSourceType?: string;\n", "")
text = text.replace("  multiplierAfter?: number;\n", "")
text = text.replace("  multiplierDelta?: number;\n", "")
write(rel, text)

# Dashboard showcase no longer considers a second player-ownership inventory.
rel = "client/src/components/dashboard-showcase-card.helpers.ts"
text = read(rel)
text = text.replace("  stackedShares?: number;\n", "")
text = re.sub(
    r'''\(Boolean\(entry\.isAlreadyBoosted\) \|\| toNumber\(entry\.stackedShares\) > 0\)''',
    "Boolean(entry.isAlreadyBoosted)",
    text,
)
write(rel, text)
rel = "client/src/components/dashboard-showcase-card.helpers.test.ts"
text = read(rel)
text = re.sub(r'^\s*stackedShares:.*\n', '', text, flags=re.MULTILINE)
write(rel, text)

# Settlement ceremony data is directly about burned Singles + capped earnings components.
rel = "client/src/hooks/use-boost-settle-ceremony.ts"
write(rel, '''import { useCallback, useState } from "react";\n\nexport interface BoostSettleCeremonyData {\n  playerName: string;\n  playerTeam: string;\n  slotTier: number;\n  effectiveMultiplier: number;\n  sharesBurned: number;\n  payout: string;\n  boostBonus: string;\n  baseComponent: string;\n  gameEps: string;\n  fantasyPoints: number;\n}\n\ninterface CeremonyState {\n  isShowing: boolean;\n  data: BoostSettleCeremonyData | null;\n}\n\nexport function useBoostSettleCeremony() {\n  const [state, setState] = useState<CeremonyState>({ isShowing: false, data: null });\n\n  const handleBoostSettled = useCallback((payload: {\n    payout: string;\n    boostBonus?: string;\n    baseComponent?: string;\n    gameEps?: string;\n    fantasyPoints: number;\n    multiplier: number;\n    slotTier?: number;\n    sharesBurned?: number;\n    playerFirstName?: string;\n    playerLastName?: string;\n    playerTeam?: string;\n  }) => {\n    const playerName = [payload.playerFirstName?.trim(), payload.playerLastName?.trim()]\n      .filter(Boolean)\n      .join(" ");\n    if (!playerName && !payload.payout) return;\n    setState({\n      isShowing: true,\n      data: {\n        playerName: playerName || "your player",\n        playerTeam: payload.playerTeam ?? "",\n        slotTier: payload.slotTier ?? payload.multiplier,\n        effectiveMultiplier: payload.multiplier,\n        sharesBurned: payload.sharesBurned ?? 0,\n        payout: payload.payout,\n        boostBonus: payload.boostBonus ?? "0.00",\n        baseComponent: payload.baseComponent ?? "0.00",\n        gameEps: payload.gameEps ?? "0.00000000",\n        fantasyPoints: payload.fantasyPoints,\n      },\n    });\n  }, []);\n\n  const closeCeremony = useCallback(() => setState({ isShowing: false, data: null }), []);\n  return { ...state, handleBoostSettled, closeCeremony };\n}\n''')

rel = "client/src/components/ceremonies/boost-ceremony-overlay.tsx"
write(rel, '''import { AnimatePresence, motion, useReducedMotion } from "framer-motion";\nimport { Flame, X } from "lucide-react";\nimport { Button } from "@/components/ui/button";\n\ninterface BoostCeremonyData {\n  playerName: string;\n  playerTeam: string;\n  slotTier: number;\n  effectiveMultiplier: number;\n  sharesBurned: number;\n  payout: string;\n  boostBonus: string;\n  baseComponent: string;\n  gameEps: string;\n}\n\nexport function BoostCeremonyOverlay({\n  isOpen,\n  data,\n  onClose,\n}: {\n  isOpen: boolean;\n  data: BoostCeremonyData | null;\n  onClose: () => void;\n}) {\n  const reduceMotion = useReducedMotion();\n  return (\n    <AnimatePresence>\n      {isOpen && data ? (\n        <motion.div\n          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm"\n          initial={{ opacity: 0 }}\n          animate={{ opacity: 1 }}\n          exit={{ opacity: 0 }}\n          onClick={onClose}\n        >\n          <motion.div\n            className="w-full max-w-sm rounded-xl border bg-card p-5 shadow-2xl"\n            initial={reduceMotion ? false : { scale: 0.94, y: 12 }}\n            animate={{ scale: 1, y: 0 }}\n            exit={reduceMotion ? undefined : { scale: 0.96, y: 8 }}\n            onClick={(event) => event.stopPropagation()}\n          >\n            <div className="flex items-start justify-between gap-3">\n              <div className="flex items-center gap-2">\n                <div className="rounded-full bg-primary/10 p-2"><Flame className="h-5 w-5 text-primary" /></div>\n                <div>\n                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Boost settled</div>\n                  <div className="font-semibold">{data.playerName}</div>\n                  {data.playerTeam && <div className="text-xs text-muted-foreground">{data.playerTeam}</div>}\n                </div>\n              </div>\n              <Button size="icon" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>\n            </div>\n            <div className="mt-5 grid grid-cols-2 gap-2 text-sm">\n              <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Effective tier</div><div className="font-mono text-xl font-bold">{data.effectiveMultiplier}x</div></div>\n              <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Singles burned</div><div className="font-mono text-xl font-bold">{data.sharesBurned.toLocaleString()}</div></div>\n              <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Base earnings</div><div className="font-mono font-semibold">{Number(data.baseComponent).toFixed(2)} SB</div></div>\n              <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Boost bonus</div><div className="font-mono font-semibold text-positive">+{Number(data.boostBonus).toFixed(2)} SB</div></div>\n            </div>\n            <div className="mt-3 rounded-lg bg-muted/50 p-3 text-center">\n              <div className="text-xs text-muted-foreground">Total game economics</div>\n              <div className="font-mono text-2xl font-bold">{Number(data.payout).toFixed(2)} SB</div>\n              <div className="mt-1 text-[11px] text-muted-foreground">Game EPS {Number(data.gameEps).toFixed(4)} · slot {data.slotTier}x</div>\n            </div>\n          </motion.div>\n        </motion.div>\n      ) : null}\n    </AnimatePresence>\n  );\n}\n''')

# Wire the new ceremony payload shape.
rel = "client/src/App.tsx"
text = read(rel)
text = text.replace(
'''    shareMultiplier: data.shareMultiplier,\n    totalMultiplier: data.totalMultiplier,\n    sharesBurned: data.sharesBurned,''',
'''    effectiveMultiplier: data.effectiveMultiplier,\n    sharesBurned: data.sharesBurned,\n    payout: data.payout,\n    boostBonus: data.boostBonus,\n    baseComponent: data.baseComponent,\n    gameEps: data.gameEps,''')
write(rel, text)

# ChatGPT action review: no retired portfolio action.
rel = "client/src/plugin-ui/action-review-panel.tsx"
text = read(rel)
text = re.sub(r'''\n\s*case "holdings_stack_shares":[\s\S]*?(?=\n\s*case )''', "", text, count=1)
write(rel, text)

# Plugin portfolio widget: Singles + LP only.
rel = "client/src/plugin-ui/sportfolio-market-portfolio-widget.tsx"
text = read(rel)
text = re.sub(r'^.*Stack Power.*\n', '', text, flags=re.MULTILINE)
text = re.sub(r'^.*stackPower.*\n', '', text, flags=re.MULTILINE)
text = re.sub(r'^.*gameplayPower.*\n', '', text, flags=re.MULTILINE)
text = re.sub(r'^.*totalStackPower.*\n', '', text, flags=re.MULTILINE)
text = re.sub(r'^.*totalGameplayPower.*\n', '', text, flags=re.MULTILINE)
write(rel, text)

# Public MCP: delete the retired tool definition and route mapping; use direct-share V2 fixture.
rel = "server/mcp/public-tool-registry.ts"
text = read(rel)
text = re.sub(
    r'''\n  defineTool\(\{\n    name: "stage_stack_shares",[\s\S]*?\n  \}\),(?=\n  defineTool\(\{\n    name: "stage_daily_boost_assign")''',
    "",
    text,
    count=1,
)
text = re.sub(r'^.*\/api\/holdings\/stack-shares.*\n', '', text, flags=re.MULTILINE)
text = text.replace('fixtureArgs: { playerId: "player_1", slotTier: 4, sport: "NBA" },', 'fixtureArgs: { playerId: "player_1", slotTier: 5, shares: 1, sport: "MLB" },')
text = text.replace('fixtureArgs: { playerId: "player_1", slotTier: 2, sport: "MLB" },', 'fixtureArgs: { playerId: "player_1", slotTier: 2, shares: 1, sport: "MLB" },')
# Remove an unused schema if it remains.
text = re.sub(r'^const stageStackSharesSchema.*?;\n', '', text, flags=re.MULTILINE)
write(rel, text)

# Discord portfolio displays one quantity only.
rel = "server/routes/discord.ts"
text = read(rel)
text = re.sub(r'^\s*const isStacked = .*\n', '', text, flags=re.MULTILINE)
text = re.sub(r'''\s*const shareType = item\.holding\?\.isStackedShare[\s\S]*?;\n''', '    const shareType = "Singles";\n', text, count=1)
write(rel, text)

# Tests: strip fields/cases that target deleted concepts; keep remaining valuation/market behavior coverage.
for rel in [
    "server/leaderboards-read-service.valuation.test.ts",
    "server/market-mobile-overview.test.ts",
    "server/mcp/plugin/sanitizer.test.ts",
    "server/mcp/plugin/ui/surface.test.ts",
    "server/routes/portfolio.test.ts",
    "server/valuation/canonical-valuation.test.ts",
]:
    path = ROOT / rel
    if not path.exists():
        continue
    text = path.read_text()
    text = text.replace("Stack Power", "non-liquid legacy inventory")
    text = re.sub(r'^.*\b(stackPower|gameplayPower|isStackedShare|stackedShares)\b.*\n', '', text, flags=re.MULTILINE)
    path.write_text(text)

# Gameplay transaction test for a deleted action is removed as a complete test block.
rel = "server/mcp/gameplay-transactions.test.ts"
text = read(rel)
text = re.sub(r'''\n\s*it\([^\n]*stack[\s\S]*?\n\s*\}\);''', '', text, flags=re.IGNORECASE, count=1)
text = text.replace('actionType: "holdings_stack_shares",', 'actionType: "daily_boost_assign",')
write(rel, text)

# Documentation and skill describe only current V2 mechanics.
rel = "server/economy/README.md"
text = read(rel).replace("- Stack Power is retired and must not be reintroduced into active runtime or public surfaces.\n", "- Player ownership is represented only by liquid Singles; Daily Boosts consume Singles directly.\n")
write(rel, text)

rel = "plugins/sportfolio/skills/sportfolio-companion/SKILL.md"
text = read(rel)
text = text.replace("Sportfolio has one player ownership asset: **Singles**. Stack Power and share-stacking are retired and must not be presented as current gameplay.", "Sportfolio has one player ownership asset: **Singles**.")
text = text.replace("When the user asks to \"stack shares,\" explain briefly that stacking was retired and users now commit Singles directly to Daily Boosts.\n\n", "")
text = text.replace("Portfolio/holdings output should describe Singles and LP positions only. Do not synthesize Stack Power fields.", "Portfolio/holdings output should describe Singles and LP positions only.")
text = text.replace("Never look for or call `stage_stack_shares`; it is retired. Never skip a staged preview for an operation that has a staged tool.", "Never skip a staged preview for an operation that has a staged tool.")
write(rel, text)

# Current public docs.
write("docs/wiki/gameplay/portfolio-and-holdings.md", '''---\nid: gameplay-portfolio-holdings\ntitle: Portfolio and Holdings\nsummary: How to read Singles, liquidity positions, market value, availability, and player earnings.\naudience: public\ncategory: gameplay\nstatus: published\nowner: product-engineering\nlastReviewedAt: 2026-08-11\nslug: portfolio-and-holdings\nsurface: web,cli\nsearchKeywords: portfolio,holdings,singles,liquidity,market value,availability\n---\n\n# Portfolio and Holdings\n\nYour player inventory is measured in **Singles**. Singles are tradeable player shares and the ownership units used for player earnings.\n\nFor each player, the portfolio shows total Singles, how many are temporarily reserved, how many remain available, cost basis, current market price when a pool is priced, market value, and unrealized gain or loss.\n\nReserved Singles are still yours but cannot be sold or committed elsewhere until the reservation clears. A Daily Boost reserves the chosen quantity before game lock and permanently burns that quantity when the valid game begins.\n\nLiquidity-provider positions are shown separately because they represent proportional claims on AMM pool reserves rather than additional player shares. Their value is included in portfolio value through the canonical LP valuation path.\n\nPlayer market capitalization uses the liquid share supply and AMM pool inventory under Sportfolio's canonical valuation rules.\n\nSee also [Player Earnings](/wiki/gameplay/player-earnings), [Daily Boosts](/wiki/gameplay/daily-boosts), and [Scouting and Share Supply](/wiki/gameplay/scouting-and-share-supply).\n''')
write("docs/wiki/getting-started/overview.md", '''---\nid: getting-started-overview\ntitle: Sportfolio Overview\nsummary: The core loop: scout players, trade Singles, earn from performance, and use direct-share Boosts.\naudience: public\ncategory: getting-started\nstatus: published\nowner: product-engineering\nlastReviewedAt: 2026-08-11\nslug: overview\nsurface: web,cli\nsearchKeywords: overview,getting started,singles,scouting,boosts,earnings\n---\n\n# Sportfolio Overview\n\nSportfolio is a virtual sports-market game. You use virtual SB to trade player Singles, scout players to create new Singles, provide AMM liquidity, and earn virtual distributions when your players perform.\n\nThe core loop is simple:\n\n1. Scout players or buy Singles from player pools.\n2. Hold Singles to participate in capped player-game earnings.\n3. Trade when your view of a player's future performance differs from the market.\n4. Optionally commit Singles to a Daily Boost for a larger one-game multiplier; those Singles are permanently burned when the valid game begins.\n5. Provide liquidity when you want exposure to pool fees and reserve value instead of only directional player inventory.\n\nMore shares never increase a player's base SB pool. They divide the same capped earnings through game EPS, so share issuance creates dilution rather than an unbounded monetary faucet.\n\nRegular-season and postseason earnings are separately normalized across MLB, NFL, NHL, and NASCAR so materially different sports and positions can have comparable full-season economic opportunity.\n\nStart with [Player Earnings](/wiki/gameplay/player-earnings), [Daily Boosts](/wiki/gameplay/daily-boosts), and [Scouting and Share Supply](/wiki/gameplay/scouting-and-share-supply).\n''')

rel = "docs/wiki/gameplay/daily-boosts.md"
text = read(rel).replace("There is no separate Stack Power asset. Boosts use Singles directly.\n\n", "Boosts use Singles directly.\n\n")
write(rel, text)

# FAQ/glossary: remove obsolete sections rather than preserve historical terminology.
rel = "docs/wiki/faq/common-questions.md"
text = read(rel)
text = re.sub(r'''\n## Singles, Stack Power, and Stacking[\s\S]*?(?=\n## |\Z)''', '\n', text, count=1)
write(rel, text)
rel = "docs/wiki/faq/glossary.md"
text = read(rel)
text = re.sub(r'''\n\*\*Stack \(Stack Power\)\*\*[\s\S]*?(?=\n\*\*|\Z)''', '\n', text, count=1)
text = re.sub(r'''\n\*\*Stack Power\*\*[\s\S]*?(?=\n\*\*|\Z)''', '\n', text, count=1)
write(rel, text)

print("Exhaustive Economy V2 residue deletion applied")
