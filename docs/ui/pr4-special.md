# PR 4 — Special features, Hermes, and native shell

## Scope

This stack layer migrates the product surfaces outside the core exchange while preserving their distinct jobs:

- Hermes chat, structured output, configuration, and strategy workspaces
- premium membership
- Scout selection, live signals, ticker, dashboard, and share notifications
- collection and milestone progress
- collection, milestone, Scout, and boost ceremonies
- whale alerts
- native status bar, keyboard, splash, safe-area, and back-button behavior

## Hermes workspace

- `/agent` is a first-class authenticated route rather than a legacy redirect.
- Agent is present in shared desktop and mobile navigation; Analytics remains available through secondary navigation on mobile.
- The workspace owns its available viewport and contains conversation and strategy scrolling without allowing content to disappear behind mobile navigation or safe-area insets.
- Structured response blocks use semantic canvas and raised-surface roles. The scrim role is reserved for overlays, preventing unreadable dark subcards in the light theme.
- The player modal mounts only when a structured player row is activated, avoiding unrelated provider/query initialization for ordinary Hermes output.
- Structured tables suppress duplicate Markdown equivalents while retaining keyboard-operable player details.

## Semantic roles

| Product meaning               | Role                        |
| ----------------------------- | --------------------------- |
| Hermes informational emphasis | `status-info`               |
| Premium value                 | `premium`                   |
| Scout discovery               | `category-scout`            |
| Whale activity                | `category-whale`            |
| Boost ceremony                | `category-boost` / `boost`  |
| Collection/community progress | `category-community`        |
| Positive completion           | `market-positive`           |
| Overlay dimming               | `scrim`                     |
| Standard nested content       | `canvas` / `surface-raised` |

Special surfaces contain no raw palette utilities, hard-coded hex values, emoji iconography, or one-off radius classes. Finite ceremonies respect reduced motion, avoid random particle layouts, and expose named close controls.

## Native behavior

- Capacitor defaults remain production-safe and point at the bundled shell unless an explicit server override is supplied.
- Runtime theme observation maps dark canvases to light status-bar content and light canvases to dark status-bar content.
- Android system-bar background and iOS keyboard appearance follow the active web theme.
- Edge-to-edge layout retains explicit safe-area handling.
- The manually controlled splash hides only after authentication bootstrap completes.
- Android back navigation yields to onboarding's nested flow, walks browser history when available, minimizes recognized root destinations, and sends history-free deep links to the app home.

## Regression evidence

- `client/src/components/special-surfaces.contract.test.ts`
  - semantic color, shape, and emoji contract across premium, Hermes, Scout, collections, milestones, ceremonies, and whale alerts
  - finite/reduced-motion ceremony contract
  - touch-safe and named Hermes mobile actions
  - scrim reserved for overlays
  - production Scout diagnostics remain hidden
- `capacitor.config.test.ts`
  - bundled production default
  - explicit development-server override
  - neutral runtime-coordinated status-bar and keyboard defaults
- `tests/e2e/agent-shell.spec.ts`
  - desktop and mobile scroll containment
  - strategy creation and navigation
  - chat-to-strategy handoff
  - structured leaderboard modal
  - slash-command behavior
- `tests/visual/special-surfaces.spec.ts`
  - deterministic desktop/mobile and dark/light evidence
  - real Hermes structured blocks and collection progress
  - premium, Scout, whale, boost, ceremony, and overlay role distinction
  - document and fixture overflow assertions
