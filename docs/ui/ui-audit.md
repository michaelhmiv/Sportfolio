# Sportfolio UI Audit

## Scope and baseline

This audit covers the complete frontend visual surface at baseline commit `d579b43ffa7c03dba768940f5915c025d652d9ba`. GitHub's production deployment record points to the same SHA, so the signed-out production screenshots are code-aligned with this worktree.

The master accounting ledger is [ui-surface-matrix.md](./ui-surface-matrix.md).

| Inventory category                                  | Count | Accounting rule                                                                       |
| --------------------------------------------------- | ----: | ------------------------------------------------------------------------------------- |
| Registered routes, aliases, redirects, and fallback |    38 | Every `Route` branch in `client/src/App.tsx`, including protected aliases and `*`     |
| Global visual contracts                             |     5 | `App.tsx`, `index.css`, Tailwind, Capacitor, and sport context                        |
| Committed visual/native assets                      |    89 | Public assets, Android/iOS icons and splashes, and attached historical binaries       |
| Accounted matrix rows                               |   304 | No frontend route or visual source file is intentionally omitted                      |
| CSS stylesheets under `client/src`                  |     1 | `client/src/index.css`                                                                |
| Shared UI primitive files                           |    60 | `client/src/components/ui/*.tsx`                                                      |
| Recharts consumers/helpers                          |     6 | Premium chart, shared chart primitive, Analytics, Player, Portfolio, and User Profile |
| Overlay/dialog/sheet/drawer/popover consumers       |    31 | Static source scan; usages require interaction validation                             |

## Baseline validation

### Automated repository gates

These commands passed on the unmodified baseline worktree after `npm ci`:

- `npm run check`
- `npm run lint`
- `npm run format:check`
- `npm run test:run` — 132 test files, 873 tests
- `npm run build`

`npm run e2e` is blocked before browser execution because the Playwright web server cannot boot without a safe local `DEV_DATABASE_URL`. The repository deliberately rejects `DATABASE_URL` in local development. No production database URL will be used to bypass this guard. A deterministic local fixture database or a database-independent visual harness must be added before protected-state E2E can be considered valid.

### Production screenshot baseline

Sanitized signed-out screenshots were captured from `https://www.sportfolio.market` with analytics/third-party calls blocked and reduced motion enabled.

| Dimension                          | Coverage                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Route families                     | Dashboard, Player Pools, Analytics, Leaderboards, News, Wiki, About, How It Works, Blog, Login, Privacy, Terms |
| Viewports                          | `360×800`, `390×844`, `412×915`, `768×1024`, `1280×800`, `1440×900`, `1920×1080`                               |
| Themes                             | Dark and light                                                                                                 |
| Total screenshots                  | 168                                                                                                            |
| Load errors                        | 0                                                                                                              |
| Uncaught page errors               | 0                                                                                                              |
| Document-level horizontal overflow | 0                                                                                                              |
| Theme-class mismatches             | 0                                                                                                              |
| Artifact size                      | 12,399,863 bytes including manifest                                                                            |

Local evidence is intentionally ignored by Git:

- `tmp/ui-overhaul-baseline/screenshots/production-public/`
- `tmp/ui-overhaul-baseline/screenshots/production-public/manifest.json`
- `tmp/ui-overhaul-baseline/logs/`

Console notes:

- Every screenshot records one harness-induced `net::ERR_FAILED` because third-party analytics/payment endpoints were deliberately aborted.
- The signed-out Player Pools route records a `401` auth-resource response at every viewport/theme even though the public market route loads. This should be normalized or avoided so signed-out public navigation does not emit expected authorization failures in the console.

### Baseline limitations

The production capture does **not** claim coverage of signed-in, premium, admin, transaction, private portfolio, or mutable states. No real account or private data was used. Deterministic sanitized fixtures are still required for:

- Signed in, non-premium, premium, and admin
- Loading, empty, filtered-empty, unavailable, error, offline, stale, and reconnecting
- Upcoming, live, delayed, and completed games
- Positive, negative, and zero market movement
- Boost available, locked, processed, settlement, and ceremony
- Notifications present/absent, unread counts, digest, and whale alert
- Modal/sheet/keyboard/back-button interaction and native safe areas

## Quantified visual debt

Static scans are prioritization signals; each match must be reviewed in context before replacement.

| Signal                                             | Matches | Files | Highest-risk hotspots                                                                                                          |
| -------------------------------------------------- | ------: | ----: | ------------------------------------------------------------------------------------------------------------------------------ |
| Functional/visual emoji from the targeted icon set |      29 |     6 | Bottom nav (11), marketplace scanners (5), player modal (5), sport context (4)                                                 |
| Motion hooks/classes                               |     556 |    92 | Shared animations (61), milestone ceremony (25), collection/boost ceremonies (23 each), result podium/scout ceremony (20 each) |
| Decorative/glow/gradient/blur treatments           |      75 |    39 | Analytics (10), Dashboard (6), decorative primitives and Marketplace (5 each)                                                  |
| Arbitrary Tailwind radii                           |       7 |     4 | Scout dashboard, chart primitive, community boost selector, scroll area                                                        |

## Major findings

### 1. Semantic color meanings are not centralized

Brand, profit, success, live, connected, premium, opportunity, warning, and destructive states are represented by direct component utilities across 81 files. This makes color meaning dependent on local author choices and creates light-theme drift.

**Required action:** define semantic CSS variables and Tailwind aliases first, then migrate shared primitives before route surfaces. Preserve compatibility variants until every consumer is accounted for.

### 2. Navigation has a provable icon and information-architecture mismatch

Desktop and mobile agree on the five primary labels, but Portfolio uses `User` in the desktop sidebar and `Briefcase` in the mobile bottom nav. Desktop exposes Wiki, Premium, and News directly; mobile does not expose them in the bottom bar and therefore needs a deliberate secondary-destination pattern. The current active mobile tab also renders a large platform-dependent sport emoji watermark behind every destination.

**Required action:** establish one typed destination/icon map, use `Briefcase` for Portfolio, retain platform-appropriate destination subsets, document secondary mobile discovery, and replace sport emoji with coherent local SVG components.

### 3. Premium treatment is persistent and visually expensive

`app-sidebar.tsx` applies a yellow border plus a large `rgba(234,179,8,0.3)` shadow to the entire sidebar for premium users. Premium links separately hardcode yellow utilities. Bottom navigation also changes its top border to yellow.

**Required action:** use a restrained premium token, crown/badge, and small accent in routine chrome. Reserve strong gold treatment for purchase and premium-content moments. Keep Boost visually distinct.

### 4. Functional sports identity is platform-dependent

The bottom-nav market drawer and active-tab watermark use emoji for NBA, NFL, MLB, NASCAR, NHL, and All Sports. Sport context and selector surfaces repeat emoji-based identity. Player modal/scanner surfaces add more functional emoji.

**Required action:** implement a six-icon local SVG family with a common view box, stroke weight, optical size, focus/selected treatment, and accessible naming contract. Do not add another icon dependency or league-owned marks.

### 5. Motion is broad and not uniformly classified

Motion appears in 92 source files. The bottom nav uses bounce, vertical movement, scale, and rotation after route activation; persistent theme rays repeat indefinitely. Celebratory surfaces appropriately use richer motion but share no documented finite/reduced-motion contract.

**Required action:** define navigation, state-transition, data-update, loading, celebration, and decorative motion categories. Centralize duration/easing tokens; remove repetitive chrome motion; ensure both Framer Motion and CSS animation honor reduced motion.

### 6. Light-mode risk is concentrated but significant

### 7. Shared primitives coexist with many direct component implementations

There are 60 shared UI files, but direct styling remains widespread in product surfaces. Button-like links, chips, count badges, status dots, card accents, and nested panel treatments are not governed by one semantic variant contract.

**Required action:** refine Button, Card, Badge/status, forms, overlays, progress, skeleton, loading, and empty/error primitives in PR 1. Migrate route surfaces in later PRs; do not create a mega-diff of unrelated class replacements.

### 8. State systems are present but fragmented

Static scan found 58 files with loading concepts, 63 with error concepts, and 13 with offline/stale/reconnect concepts. The repository has dedicated skeleton, loading button, error boundary, offline banner, connection status, native network, query, and WebSocket layers, but route-level composition is inconsistent and not yet covered by deterministic screenshots.

**Required action:** preserve all state logic and data contracts; standardize only presentation, copy hierarchy, retry affordance, and accessible announcements. Add fixture-backed state matrices before claiming completeness.

### 9. Charts need one semantic contract

Six Recharts consumers/helpers span premium, analytics, player, portfolio, and profile contexts. Literal chart colors remain in the shared chart helper and route consumers.

**Required action:** provide documented series/grid/axis/tooltip tokens, semantic positive/negative movement, narrow-width tooltip constraints, reduced motion, and non-color cues where series could be confused. Preserve polling and data formatting behavior.

### 10. Native branding is hardcoded separately from web tokens

Capacitor splash/status bar use `#0f1420`, status bar style is fixed to `DARK`, and keyboard style is fixed to dark. Android/iOS launch assets are separately committed.

**Required action:** coordinate native canvas/status/splash values with the final dark token and confirm light-theme/native system behavior. Do not change native routing, back handling, haptics, deep links, push behavior, or economics.

### 11. Orphan/unregistered surfaces need explicit disposition

**Required action:** never delete these during visual cleanup without proving reachability and receiving scope approval. Audit them for future compatibility or mark them intentionally deferred with a reason.

### 12. Protected-route fallback is visually misleading

The active baseline renders `<Dashboard />` for unauthenticated visits to `/power`, `/boosts`, `/player/*`, `/portfolio`, `/admin`, `/premium`, and `/watchlists` while retaining the protected URL. Several page-level signed-out treatments are therefore normally unreachable. This is verified in `client/src/App.tsx:865-900`.

**Required action:** preserve authorization and route behavior during this overhaul. Account for the retained-URL dashboard fallback in visual regression tests, avoid presenting it as the destination page, and defer any redirect/auth-flow change to a separately approved behavior PR.

### 13. The `/admin` frontend gate is authentication-only

The active baseline routes `/admin` using `canAccessProtectedRoutes`, which is `isAuthenticated || authRouteBypass`. `admin.tsx` contains no `useAuth`, `isAdmin`, role, 403, or forbidden guard. Backend authorization may still reject operations, but the frontend controls are renderable by any authenticated user and by the loopback Playwright bypass.

**Required action:** treat this as a verified security/authorization finding outside the visual-overhaul scope. Do not silently alter authorization in a UI PR. Keep admin fixtures synthetic and request a separate security decision before changing the guard.

### 14. Query failure is frequently presented as empty or missing data

The route review found error/empty conflation on Dashboard, Pools, Leaderboards, Blog, News, Watchlists, Analytics, User Profile, Blog Post, Discord linking, Account Deletion, Admin, Premium, Boosts, and primary Portfolio data. The global render-time `ErrorBoundary` does not handle React Query rejection states.

**Required action:** use the shared visual state system to make error, empty, unavailable, stale, and offline states distinguishable while preserving every query key, request, retry rule, and data contract. Add deterministic fixtures for each state before migrating a route.

### 15. The 404 page is the strongest active theme outlier

`client/src/pages/not-found.tsx` uses `bg-gray-50`, `text-gray-900`, `text-gray-600`, and `text-red-500` regardless of theme and displays developer-facing copy: “Did you forget to add the page to the router?” It provides no home, back, search, or recovery action.

**Required action:** migrate it in PR 5 to the semantic public-shell and state-surface contract, replace developer copy with user-facing recovery guidance, and preserve catch-all route semantics.

### 16. Auth-sensitive public declarations and blank redirects need coverage

**Required action:** preserve the flows in the visual PR series, record them as compatibility cases, and exercise them with sanitized fixtures. Any bootstrap-prefix or redirect implementation change requires separate functional review.

### 17. Generic and sport-prefixed player routes overlap

`/player/:id` is declared before `/player/nba_:id`, `/player/nfl_:id`, and `/player/mlb_:id`. The generic route accepts those prefixed IDs, making the later route declarations redundant under the current Wouter `Switch` order.

**Required action:** do not reorder or remove routes during visual work. Use the canonical generic route for screenshot coverage and defer route cleanup to a separately approved behavior change.

## PR boundaries

| PR  | Scope                                                                   | Safety rule                                                                    |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | Audit, semantic tokens, shared primitives, deterministic visual harness | No route-wide migration; compatibility variants remain                         |
| 2   | Shell, nav map, sport SVGs, global statuses, safe-area chrome           | Preserve route subsets, preloading, haptics, auth gating, native back behavior |
| 3   | Dashboard, market/player, portfolio, boosts, analytics, games, charts   | No server economics, API, query, WebSocket, or trading changes                 |
| 4   | Premium, collections, milestones, ceremonies, and native polish         | Finite/reduced motion; no overlapping overlays; preserve entitlements          |
| 5   | Public, auth, editorial, legal, admin, accessibility, final cleanup     | Preserve SEO, callbacks, external links, authorization, and route semantics    |

Each PR must be independently buildable, testable, and reviewable. Pull requests remain unmerged.

## Completion policy

A route or source file may finish in exactly one state:

1. **Completed and validated**
2. **Intentionally unchanged because it already complies**, with evidence
3. **Explicitly deferred**, with a reason, owner/target issue if applicable, and compatibility assessment

“Inventoried” alone is not completion. Final review must reconcile every row in the surface matrix and capture matched after evidence using the same sanitized fixtures, routes, viewports, themes, and reduced-motion setting.
