# Sportfolio Visual System

> Status: proposed contract for the UI-overhaul PR series. Token names and component semantics in this document are normative; exact color values may be tuned only with recorded light/dark WCAG contrast results. The implementation must be updated with this document in the same PR.

## Product visual principles

1. **Sports exchange first.** Market value, price movement, liquidity, holdings, game state, and action context remain primary; player, team, sport, and opponent identity make instruments recognizable.
2. **Terminal precision without generic fintech anonymity.** Compact alignment, tabular numerals, disciplined surfaces, and restrained motion combine with sports-specific identity.
3. **Semantic before decorative.** Color, border, type, icon, and motion communicate meaning. Persistent glow, gradients, patterns, and accent bars do not decorate ordinary cards.
4. **Dark-primary, not dark-only.** Dark mode is the flagship presentation; light mode is independently authored and WCAG-tested.
5. **Dense, not crowded.** Improve hierarchy through alignment, grouping, typography, and surface contrast rather than adding whitespace everywhere.
6. **Color reinforces meaning; it never owns meaning.** Statuses pair color with text, icon, shape, or line/marker style.
7. **Reusable at the source.** Add a token or typed variant when a meaning recurs. Avoid one-off class patches and giant conditional class expressions.
8. **Native-safe by default.** Every shell, overlay, input, and sticky action accounts for safe areas, keyboard resize, touch targets, back behavior, and reduced motion.

## Token architecture

CSS variables remain channel values consumed as `hsl(var(--token) / <alpha-value>)` unless a token explicitly stores a complete shadow or timing value. Tailwind aliases use semantic names rather than literal palette names.

### Existing compatibility tokens

The migration must keep existing shadcn-style tokens (`background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `input`, `ring`, `chart-*`, and sidebar tokens) until every consumer is migrated. New semantic tokens may map to them where meanings genuinely match.

### Required semantic color tokens

| Meaning           | CSS token family                                                                    | Tailwind intent                  | Directional anchor            | Rules                                                                                |
| ----------------- | ----------------------------------------------------------------------------------- | -------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| Brand             | `--brand`, `--brand-foreground`, `--brand-subtle`                                   | `brand`                          | Emerald `#22C55E`             | Identity and primary brand moments; never reused as profit/live/connected by default |
| Canvas            | `--canvas`                                                                          | `canvas`                         | Dark `#0F131B`                | Application background                                                               |
| Surface 1         | `--surface`                                                                         | `surface`                        | Dark `#181E29`                | Standard card/panel                                                                  |
| Surface 2         | `--surface-raised`                                                                  | `surface-raised`                 | Dark `#202837`                | Interactive/raised/overlay groups                                                    |
| Foreground        | `--text`, `--text-muted`, `--text-subtle`, `--text-inverse`                         | `text-*`                         | Theme-specific                | Four documented hierarchy levels; all body text AA                                   |
| Border            | `--border-subtle`, `--border-strong`                                                | `border-subtle`, `border-strong` | Dark `#2A3342` / `#364152`    | Standard separation vs active/strong divider                                         |
| Focus             | `--focus-ring`, `--focus-offset`                                                    | `focus`                          | Brand-adjacent, high contrast | Visible in both themes; never removed without equivalent                             |
| Primary action    | `--action-primary`, `--action-primary-foreground`                                   | `action-primary`                 | Emerald family                | Main workflow action only                                                            |
| Secondary action  | `--action-secondary`, `--action-secondary-foreground`                               | `action-secondary`               | Neutral surface               | Lower-priority actions                                                               |
| Positive movement | `--market-positive`, `--market-positive-subtle`                                     | `market-positive`                | Teal `#14B8A6`                | Price/performance gain only                                                          |
| Negative movement | `--market-negative`, `--market-negative-subtle`                                     | `market-negative`                | Coral `#F05B68`               | Price/performance loss; not destructive account actions                              |
| Live              | `--status-live`, `--status-live-subtle`                                             | `status-live`                    | Vivid red-coral `#F43F5E`     | Live game/event urgency only; pair with “Live” and/or broadcast icon                 |
| Upcoming/info     | `--status-upcoming`, `--status-info`                                                | `status-upcoming`, `status-info` | Blue `#60A5FA`                | Scheduled/upcoming/informational state                                               |
| Warning           | `--status-warning`, `--status-warning-subtle`                                       | `status-warning`                 | Warm amber                    | Risk or attention that is neither boost nor premium                                  |
| Boost             | `--boost`, `--boost-subtle`, `--boost-foreground`                                   | `boost`                          | Warm gold `#F4B740`           | Opportunity/boost mechanics; pair with `Zap`/label                                   |
| Premium           | `--premium`, `--premium-subtle`, `--premium-foreground`                             | `premium`                        | Restrained gold `#D6A84F`     | Entitlement/upgrade; routine chrome uses only a small accent                         |
| Destructive       | `--destructive`, `--destructive-subtle`                                             | `destructive`                    | Theme-tested red              | Irreversible/dangerous user action; visually distinct from market loss               |
| Disabled          | `--disabled`, `--disabled-foreground`, `--disabled-border`                          | `disabled`                       | Slate neutral                 | Legible but clearly unavailable; not opacity alone where text fails contrast         |
| Connectivity      | `--status-offline`, `--status-stale`, `--status-reconnecting`, `--status-connected` | `status-*`                       | Slate/amber/blue/teal         | Pair with explicit language and icon; stale data must say it may be outdated         |
| Selected          | `--selected`, `--selected-foreground`, `--selected-border`                          | `selected`                       | Theme-specific                | Active state has at least two cues (surface/border/icon/type)                        |
| Interaction       | `--hover`, `--pressed`                                                              | `hover`, `pressed`               | Theme-specific neutral        | Shared interactive surface behavior                                                  |
| Skeleton          | `--skeleton`, `--skeleton-highlight`                                                | `skeleton`                       | Surface-relative              | Resembles destination layout; shimmer optional and reduced-motion-safe               |
| Overlay           | `--scrim`, `--overlay-surface`                                                      | `scrim`, `overlay`               | Theme-specific                | One documented scrim opacity and overlay surface                                     |
| Data grid         | `--chart-grid`, `--chart-axis`, `--chart-tooltip`                                   | `chart-*`                        | Theme-specific                | Readable but visually subordinate                                                    |
| Team accent       | `--team-accent`, `--team-accent-foreground`                                         | Inline CSS variable only         | Data-derived                  | Accent border/dot/avatar ring only; never entire card fill                           |

### Chart series

Provide at least eight theme-tested series tokens (`--chart-series-1` … `--chart-series-8`) plus semantic positive/negative/live series. Series order must be stable. When two series could be confused, add line dash, marker, direct label, or pattern rather than only changing hue.

### Elevation and shadows

| Token                  | Use                                      |
| ---------------------- | ---------------------------------------- |
| `--shadow-none`        | Dense terminal panels and table rows     |
| `--shadow-low`         | Standard raised interactive surface      |
| `--shadow-medium`      | Popovers, menus, sticky actions          |
| `--shadow-overlay`     | Dialogs/sheets only                      |
| `--shadow-celebration` | Temporary ceremony/purchase moments only |

Ordinary cards use **surface + border** as primary hierarchy. Do not stack border, shadow, glow, gradient, pattern, and accent stripe on the same ordinary card.

### Radius scale

| Token                 | Target | Use                                |
| --------------------- | -----: | ---------------------------------- |
| `--radius-control-sm` |    6px | Compact terminal controls          |
| `--radius-control`    |    8px | Buttons, inputs, tabs              |
| `--radius-card`       |   10px | Major cards, panels, sheets        |
| `--radius-pill`       |  999px | Status chips only                  |
| `--radius-circle`     |    50% | Status lights and circular avatars |

Variant names must match output. A `circle` variant renders a circle, not a slightly rounded square.

### Spacing scale

Retain Tailwind's base spacing where it already maps cleanly, but define semantic component decisions:

- Page gutter: 16px mobile, 24px tablet, 24–32px desktop according to the existing max-width container
- Compact row inline gap: 6–8px
- Standard control gap: 8px
- Card padding: 12px dense, 16px standard, 20–24px marketing/large overlay
- Section gap: 16px dense, 24px standard, 32–48px editorial/marketing
- Mobile bottom clearance: bottom-nav height + `env(safe-area-inset-bottom)` + local action spacing
- Minimum touch target: 44×44 CSS pixels; icon glyph may remain 16–20px

Density variants must be explicit (`dense`, `standard`, `spacious`) rather than random local padding.

### Typography

#### Families

- **Inter:** navigation, titles, player names, explanatory copy, buttons, forms, editorial content
- **JetBrains Mono:** prices, holdings/share counts, percentages, market symbols, rankings, time-sensitive market metadata, compact numerical columns

#### Usage rules

- Use `font-variant-numeric: tabular-nums` for changing/columnar values.
- Right-align comparable numeric table columns.
- Use uppercase wide tracking only for section labels, compact terminal controls, and short status labels.
- Use sentence case for primary actions, navigation, form labels, dialog actions, and readable explanatory badges.
- Keep mobile form controls at 16px minimum to avoid WebView zoom.
- Test long player/team names, localization growth, 200% browser zoom, and larger native font settings.
- Never encode a sign only by color; screen-reader text should announce “up/down” or “gain/loss” with the value.

Suggested role names: `display-market`, `title-page`, `title-section`, `title-card`, `body`, `body-compact`, `label`, `label-terminal`, `data-lg`, `data`, `data-compact`, `caption`.

## Component contracts

### Buttons and actions

Required typed variants:

- `primary`
- `secondary`
- `outline`
- `ghost`
- `destructive`
- `terminal`
- `terminalOutline`
- `marketBuy`
- `marketSell`
- `premium`
- `icon`

Rules:

1. Buy/Sell pair text with direction icon or explicit label; green/red is not the sole cue.
2. Destructive account actions do not reuse market-loss styling.
3. Loading preserves width where practical and keeps the accessible name/state.
4. Disabled remains legible and non-interactive.
5. Icon-only buttons have an accessible name and desktop tooltip; essential mobile meaning never depends on a tooltip.
6. Focus, hover, pressed, loading, and disabled states are defined in both themes.
7. Primary workflow actions use sentence case; compact terminal actions may use uppercase mono.
8. Preserve every event handler, auth gate, guard, haptic, analytics event, and mutation state during migration.

### Cards, panels, and rows

Required families:

- Standard content card
- Interactive market/player card
- Dense terminal panel
- Summary/stat card
- Alert card
- Live-game card
- Premium card
- Empty-state card
- Modal/sheet content group
- Table/list row
- Selected row
- Disabled/unavailable row

Clickable cards expose hover/pressed/focus cues and valid keyboard behavior. Nested actions must not trigger the full-card action. Avoid card-within-card nesting when border/grouping is sufficient.

### Badges, chips, and indicators

Required variants:

- Neutral informational chip
- Semantic status chip
- Urgent/actionable chip
- Count badge
- Notification badge
- Live indicator
- Premium indicator
- Rank/medal indicator
- Multiplier/power indicator

Lower-priority signals use a neutral chip with semantic icon/dot. Fully colored background/border/text is reserved for urgent or highly actionable states. Status lights are circular. “Live” is one shared indicator everywhere.

### Forms

- Visible associated labels; placeholder is never the only label.
- One error/help/success/disabled presentation contract.
- Obvious focus ring in both themes.
- 16px minimum mobile input text.
- Keyboard-safe sheets and sticky actions.
- Native HTML semantics before ARIA.
- Error copy explains recovery where possible.
- Preserve validation, input modes, autocomplete, submission, and native keyboard behavior.

### Overlays

Dialog, alert dialog, drawer, sheet, popover, tooltip, command surface, toast, player modal, special product surfaces and ceremonies share:

- Overlay/scrim tokens
- Radius/padding/heading/action hierarchy
- Focus trap/restoration and Escape behavior on web
- Native back behavior and safe-area padding
- Scrollable content with actions still reachable
- One documented layer map
- Reduced-motion transitions

Proposed layer order:

1. Page/sticky content
2. Sidebar/header/bottom navigation
3. Popover/menu/tooltip
4. Sheet/drawer/dialog/player modal
5. Critical confirmation
6. Ceremony/transaction result
7. Toast/connection status, positioned so navigation/actions remain usable

Stacked modal flows require a documented necessity and interaction test.

### Loading, empty, stale, offline, and error states

- Skeletons mirror final geometry and avoid major layout shift.
- Empty explains why and offers the next useful action.
- Filtered-empty differs from truly empty.
- Offline/stale/reconnecting preserves visible cached data where safe, says whether data may be stale, and provides retry only when supported.
- Error messages hide stack traces and sensitive details, preserve safe retry behavior, and offer route recovery.
- Live announcements are concise and throttled to avoid screen-reader overload.

## Iconography and identity

### Permanent navigation map

| Destination  | Icon                                                                                    |
| ------------ | --------------------------------------------------------------------------------------- |
| Dashboard    | `Home`                                                                                  |
| Player Pools | Shared sports-market icon; use a local sports-market SVG if `TrendingUp` is too generic |
| Boosts       | `Zap`                                                                                   |
| Portfolio    | `Briefcase`                                                                             |
| Analytics    | `BarChart3`                                                                             |
| News         | `Newspaper`                                                                             |
| Wiki         | `BookOpen`                                                                              |
| Premium      | `Crown`                                                                                 |
| User profile | `User` only when the destination is specifically the user profile                       |

Desktop and mobile consume one typed destination map. Platform subsets may differ, but names and icons do not.

### Sport icon family

Create local SVG React components for All Sports, NBA/basketball, NFL/football, MLB/baseball, NHL/hockey, and NASCAR/motorsport. Requirements:

- Shared 24×24 view box and optical bounds
- Consistent stroke/corner treatment with Lucide
- `currentColor` by default
- Selected/inactive/disabled states driven by shared tokens
- Decorative instances `aria-hidden`; meaningful instances receive an accessible label through the parent control
- No league-owned logos unless existing rights and repository usage are verified
- No emoji in functional navigation, filters, statuses, watermarks, or actions

### Player/team/game identity

Use, where reliable: headshot, team mark/abbreviation, position, jersey number, sport icon, opponent/schedule, and game state. Market value and action context remain primary. Team color is an accent only. Images reserve dimensions, provide robust fallback, avoid cumulative layout shift, and use informative alt text only when the image adds meaning.

## Charts and data visualization

- Shared token palette for series, positive/negative, grid, axes, labels, legend, and tooltip.
- Stable currency, percentage, fantasy point, volume, market-cap, TVL, share, and date formatting.
- Responsive container with reserved height to avoid layout shift.
- Tooltip constrained to the viewport.
- Zero, null, stale, loading, sparse, and one-point datasets render intentionally.
- Initial/live animation is restrained and disabled/reduced when requested.
- Important insight has a text summary or accessible name where practical.
- Preserve live polling, WebSocket behavior, query caching, and data shape.

## Motion and haptics

| Category            | Policy                                                                      |
| ------------------- | --------------------------------------------------------------------------- |
| Navigation feedback | Subtle, ≤200ms, no bounce/rotation in persistent chrome                     |
| State transition    | 150–250ms, opacity/short translation where it aids continuity               |
| Data update         | One finite highlight; never obscure the new value                           |
| Loading             | Skeleton/progress; no indefinite pulse after error                          |
| Celebration         | Expressive but finite, cancelable by reduced motion, bounded for mobile GPU |
| Decorative          | Rare; no purpose means remove it                                            |

Define `--motion-fast`, `--motion-standard`, `--motion-slow`, `--ease-standard`, and `--ease-emphasized`. CSS and Framer Motion must both honor `prefers-reduced-motion`. Preserve haptics only where they confirm a meaningful action or navigation change.

## Backgrounds, gradients, and decoration

Use one restrained Sportfolio motif: a subtle market grid. It may appear on major headers, onboarding, empty states, premium marketing, and celebrations. Ordinary market cards, portfolio rows, forms, and tables remain clean.

Strong effects are reserved for live urgency, critical alerts, premium purchase moments, boost/scout ceremonies, milestones/collections, and selected high-value actions.

## Accessibility contract

Target WCAG 2.2 AA for relevant web content:

- Normal text contrast ≥4.5:1; large text ≥3:1
- Non-text controls/focus/meaningful graphics ≥3:1 against adjacent colors
- Visible keyboard focus with logical order and restoration
- Correct headings, landmarks, labels, descriptions, table semantics, `aria-current`, and restrained `aria-live`
- 44×44 CSS-pixel mobile touch targets where applicable
- 200% zoom and 320px-class reflow without loss of function
- Color-independent status and chart meaning
- Finite/reduced motion
- Dialog focus trap and accessible name/description
- Alt text only when informative; decorative images/icons hidden from assistive technology

Do not add redundant ARIA to native semantic elements.

## Native contract

- Body/shell uses safe-area insets on all four sides where relevant.
- Bottom navigation and sticky actions reserve content clearance.
- Keyboard resize keeps focused controls and dialog actions visible.
- Android back closes the topmost dismissible overlay before navigating.
- Native deep links and route semantics remain unchanged.
- Status bar, splash background, launcher/icon assets, and WebView canvas coordinate with final tokens.
- Dark/light system preferences are tested; fixed dark status/keyboard settings require an explicit documented product decision.
- Orientation and larger system font are tested where supported.

## Examples and anti-patterns

| Prefer                                             | Avoid                                                       |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `text-market-positive` + `ArrowUp` + signed value  | `text-green-500` as the only gain cue                       |
| `status="live"` shared indicator                   | Local red/green dots with different capitalization          |
| Neutral chip + small semantic dot for low priority | Five simultaneous brightly colored pills                    |
| `variant="premium"` with a small crown/accent      | Permanent gold glow around the whole sidebar                |
| Shared `SportIcon` family                          | Emoji filters and giant emoji active-tab watermark          |
| Surface + border hierarchy                         | Border + shadow + glow + gradient + pattern + accent stripe |
| `font-mono tabular-nums` for prices                | Mono uppercase for every action and paragraph               |
| One typed card/status/button variant               | Repeated arbitrary class strings across route files         |
| Matched light/dark screenshots and contrast checks | Assuming a `dark:` class makes light mode complete          |

## Change-control checklist

Before accepting a visual-system change:

- [ ] Improves consistency, hierarchy, readability, accessibility, or sports-exchange identity
- [ ] Preserves the workflow and all behavior/data contracts
- [ ] Uses or adds a reusable semantic token/variant
- [ ] Works in light and dark themes
- [ ] Works at target responsive widths and in Capacitor where applicable
- [ ] Communicates without color alone
- [ ] Avoids unnecessary dependencies and persistent GPU-heavy effects
- [ ] Has focused tests and matched visual evidence where risk warrants it
- [ ] Updates this document and the surface matrix in the same PR
