# PR 2 — Application shell and sport identity

This stacked change applies the visual-system foundation to Sportfolio's persistent chrome while preserving routing, authentication gates, query keys, haptics, and native behavior.

## Changes

- Centralized desktop/mobile route labels, destinations, icons, access requirements, and active-route matching in `client/src/lib/app-navigation.ts`.
- Added local, current-color SVG marks for NBA, NFL, MLB, NHL, NASCAR, and All Sports in `client/src/components/sport-icon.tsx`.
- Rebuilt desktop and mobile navigation around the shared map, explicit `aria-current`, route preloading, 44px mobile targets, safe-area insets, and reduced-motion-aware feedback.
- Removed functional sport emoji and the decorative active-sport watermark from persistent mobile chrome.
- Standardized premium, boost, notification, unread, offline, and reconnecting status treatment with semantic tokens and text/icon labels.
- Compacted the global header and footer into a consistent exchange hierarchy with terminal balance typography and semantic status indicators.
- Added deterministic desktop/mobile, dark/light navigation snapshots using the real rendered shell DOM.

## Regression coverage

| Gate              |                                Result |
| ----------------- | ------------------------------------: |
| TypeScript        |                                Passed |
| ESLint            |                                Passed |
| Prettier          |                                Passed |
| Unit/contract     |           954 passed across 140 files |
| Production build  |                                Passed |
| Visual regression |                             12 passed |
| Product E2E       | 11 passed, 14 known baseline failures |

The E2E failure set is unchanged from PR 1: seven removed `/agent` workspace expectations, four legacy MLB modal expectations, two auth wording/transition expectations, and one removed mobile boost-window expectation. No shell test regressed.

## Reviewed snapshots

- `tests/visual/__screenshots__/desktop-dark/application-shell-navigation.png`
- `tests/visual/__screenshots__/desktop-light/application-shell-navigation.png`
- `tests/visual/__screenshots__/mobile-dark/application-shell-navigation.png`
- `tests/visual/__screenshots__/mobile-light/application-shell-navigation.png`
