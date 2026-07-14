# PR 3 — Core sports-exchange surfaces

This stacked change migrates Sportfolio's decision-heavy market, player, portfolio, boost, analytics, leaderboard, watchlist, and game surfaces onto the semantic visual-system contract established in PR 1.

## Core migration

- Replaced hardcoded Tailwind palettes and generic radius utilities across the production core surfaces with semantic market, status, category, chart, boost, premium, overlay, content, surface, border, and radius roles.
- Added a source contract that rejects standard hardcoded Tailwind palette families and generic radii in the migrated core surfaces.
- Added dedicated semantic category roles for market, liquidity, stacking, payout, scout, whale, thin-pool, boost, community, momentum, value, pool activity, and user ownership instead of conflating product states with live/loss or chart-series aliases. Their dark-mode treatments are contractually unique.
- Removed chart-series aliases from mobile market chips, pool/LP context, Boosts, portfolio stacking, multiplier and stacking chrome, player market-cap/liquidity badges, game cards, community/heat signals, and owned-player highlights. Chart tokens are now reserved for actual data visualization.
- Exposed multiplier-tier selection with `aria-pressed`, and kept owned-player highlights on the ownership role rather than stacking.
- Preserved route paths, query keys, mutation paths, authentication gates, economics, haptics, and data behavior.
- Kept positive and negative movement explicit through signed values and directional cues rather than color alone.

## Multiplier tiers

- Added five explicit multiplier-tier tokens: standard, boosted, elite, legendary, and mythic.
- Kept every tier visually distinct in both themes instead of collapsing stacked holdings into one generic accent.
- Added WCAG AA contrast checks for inverse text on tier backgrounds and for semantic text after its interaction tint is alpha-composited over real card and canvas surfaces. A source-derived scanner exercises same-class semantic text/background combinations across the declared core surfaces, while explicit regression cases cover ancestor-provided translucent tier backgrounds and selected-tier interaction states.

## Game hierarchy

The MLB lifecycle panel now follows decision priority:

1. Score and state
2. User exposure and estimated earnings
3. Starting lineups
4. Collapsed scoring summary
5. Remaining secondary context

Exposure is available during live/final states, posted lineups remain visible after first pitch, and scoring plays are collapsed by default with `aria-expanded`, `aria-controls`, a 44px mobile trigger, and reduced-motion handling. Loading and error states no longer masquerade as zero exposure, partial enrichment falls back to live-stat scores and then core game scores, and completed games use final-state wording. Pregame venue context remains visible in the modal header.

## Watchlists

- Made list expansion keyboard-operable with a real button and `aria-expanded`.
- Added accessible names for add, edit, delete, and remove icon actions.
- Raised those controls to 44px on mobile while retaining compact 32px desktop controls.
- Converted player-search results to keyboard-operable buttons without nesting the interactive `PlayerName` control.
- Kept controls wrapping within the card rather than using horizontal scrolling.

## Regression evidence

- Deterministic token-and-density fixture covering compact market rows, portfolio movement, all five multiplier tiers, all nine product-semantic treatments, and the game-information hierarchy.
- Desktop/mobile and dark/light screenshot baselines, with explicit class-based dark-mode activation and strict pixel thresholds.
- Visual assertions for hierarchy order, tier and category-treatment distinction, positive/negative non-color cues, and measured document overflow.
- Production MLB modal screenshots for live and final states, captured at a fixed clock, settled fonts, and reset scroll position. The strict 0.1% baselines passed 20/20 serial repetitions and 6/6 three-worker repetitions.
- Production E2E coverage for live/final hierarchy, collapsed scoring content, score fallback, loading/error honesty, scheduled context, unavailable final data, and the mobile trade sheet.

## Validation

| Gate                    |                                                  Result |
| ----------------------- | ------------------------------------------------------: |
| Prettier                |                                                    pass |
| ESLint                  |                                                    pass |
| TypeScript              |                                                    pass |
| Unit/contract           |                           989/989 pass across 141 files |
| Production build        |                                                    pass |
| Visual regression       |                                              16/16 pass |
| Focused PR 3 E2E        |                                                8/8 pass |
| Current full-E2E matrix | 18 pass / 9 documented cross-PR contract-drift failures |

The remaining full-E2E failures are outside PR 3's core-surface contract: seven tests target the removed `/agent` workspace and belong to PR 4's Scout/Hermes work; two auth copy/transition expectations belong to PR 5. The reliable full run uses one worker because the host cannot launch seven Chromium workers without exhausting its thread limit.
