# Sportfolio ChatGPT UI Architecture

## Scope

Sportfolio exposes interactive MCP Apps UI in addition to its shared public business-tool catalog. The UI layer is presentation-only: it builds bounded, sanitized view models and calls the same shared Sportfolio tools used by other MCP clients for all mutations.

## Demo and smoke fixtures

Presentation metadata must use production-shaped identifiers so developer-mode
tool previews exercise the success path instead of manufacturing a template
failure. The current public fixtures use `mlb_669022` for the player market and
`mlb_game_1` for the live-event contract. A real ChatGPT demo should still
resolve a player or event through the corresponding data tool first and pass
the returned identifier to the render tool.

## Architectural boundary

- `server/mcp/public-tool-registry.ts` remains the source of truth for reusable business reads and writes.
- `server/mcp/plugin/registry.ts` exposes shared business-tool parity through the OAuth marketplace endpoint.
- `server/mcp/plugin/ui/*-surface.ts` owns plugin-only `render_*` presentation tools and view-model shaping.
- `server/mcp/plugin/ui/shared-resource.ts` registers the single canonical content-addressed MCP App resource.
- `client/src/plugin-ui/sportfolio-widget-entry.ts` waits for the real MCP tool result and selects the correct React surface from `structuredContent.view`.
- `client/src/plugin-ui/openai-host.ts` implements the MCP Apps bridge and caches tool input/result/global state so lazily mounted surfaces can hydrate from notifications that arrived before they loaded.
- `scripts/build-plugin-ui.mjs` builds one self-contained ESM module and embeds it directly in the MCP HTML resource.

Presentation tools are always read-only, non-destructive, and closed-world. They are intentionally excluded from the shared business-tool parity assertion.

## Canonical resource

Every current presentation tool advertises the same immutable URI:

`ui://sportfolio/app/<content-hash>.html`

The hash is derived from the generated HTML resource. A build that changes the HTML, JavaScript, or CSS therefore produces a new resource URI and avoids stale ChatGPT component caches.

The resource uses `text/html;profile=mcp-app` and contains the widget JavaScript inline. It does not depend on a second external JavaScript request after the iframe is created.

Legacy semantic URI constants such as `ui://sportfolio/scouting/v1.html` remain useful inside surface catalogs/tests, but the production MCP server suppresses those registrations and exposes only the canonical shared resource.

## Registered views

| Presentation tool           | View            | Purpose                                                                                   |
| --------------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `render_player_market`      | `player_market` | Player identity, AMM market, bounded history, holding context, quotes, and staged trading |
| `render_trade_preview`      | `trade_preview` | Compatibility staged-trade review                                                         |
| `render_portfolio`          | `portfolio`     | Connected Singles/LP portfolio and allocation                                             |
| `render_market_movers`      | `market_movers` | Gainers, decliners, volume, trade activity, and watchlist movers                          |
| `render_liquidity_position` | `liquidity`     | AMM pool and connected LP position                                                        |
| `render_score_slate`        | `score_slate`   | Compact schedule and scores                                                               |
| `render_live_event`         | `live_event`    | One resolved live event with optional PiP                                                 |
| `render_game_insights`      | `game_insights` | Connected holding/boost exposure across a slate                                           |
| `render_action_review`      | `action_review` | Exact staged action review with Confirm/Cancel controls                                   |
| `render_scouting`           | `scouting`      | Scout status, assignments, capacity, and opportunities                                    |
| `render_boosts`             | `boosts`        | Daily Boost slots, candidates, active boosts, history, and community state                |
| `render_watchlist`          | `watchlist`     | Connected watchlists                                                                      |
| `render_dashboard`          | `dashboard`     | Account snapshot and progress                                                             |
| `render_collections`        | `collections`   | Collection progress and detail                                                            |
| `render_rankings`           | `rankings`      | Canonical Sportfolio rankings                                                             |

## Runtime flow

1. ChatGPT creates the iframe from the canonical UI resource.
2. The entry module subscribes to MCP Apps messages before selecting a surface.
3. `ui/notifications/tool-result` is cached by `openai-host.ts`.
4. The entry module reads `structuredContent.view` from that cached result and loads the owning React surface.
5. The newly mounted surface reads the same cached result and renders immediately.
6. Later tool results are handled by the mounted surface without remounting the iframe.

`window.openai.toolOutput` remains a compatibility fallback only. Correct rendering must not depend on it being populated synchronously before the iframe JavaScript starts.

## Mutation safety

The widget never calls Sportfolio REST mutation routes. It invokes MCP tools through `window.openai.callTool` when available and the standard MCP Apps `tools/call` bridge otherwise.

Market actions use:

1. `get_amm_trade_quote`
2. `stage_market_buy` or `stage_market_sell`
3. `confirm_pending_action` or `cancel_pending_action`

Liquidity, scouting, boosts, and other gameplay writes follow the same staged-action model. The UI confirms only the server-issued transaction identifier and never recreates a staged payload client-side.

## State and refresh behavior

Authoritative prices, balances, holdings, quotes, scouting state, boosts, and LP positions always come from Sportfolio server calls. Widget state is limited to presentation choices such as selected range, buy/sell mode, form inputs, selected rows, and current view state.

The host bridge caches notifications so initialization order cannot discard authoritative tool results. MCP Apps initialization is idempotent even though multiple React surfaces share the same host helper.

## Security

- UI resources use `text/html;profile=mcp-app`.
- The canonical resource URI is content-addressed.
- CSP allows no direct network connections from the widget and only the Sportfolio site origin for resource loading.
- Private portfolio, holding, balance, pending-action, scouting, boost, and liquidity data require OAuth where applicable.
- Public player names are converted to display names before the plugin sanitizer runs; account PII remains subject to the existing sanitizer deny list.
- The iframe never receives OAuth credentials or Sportfolio API tokens.

## Feature flags

`PLUGIN_UI_ENABLED` controls the presentation layer globally. Dedicated `PLUGIN_UI_*` flags control individual surfaces and default to enabled when unset. Values `false`, `0`, `off`, and `no` disable a flag.

## Validation

Plugin Readiness now verifies the runtime rather than only the source inventory:

- plugin-specific and repository TypeScript checks;
- production build of the self-contained MCP resource;
- delayed MCP tool-result bridge snapshot tests;
- delayed surface-routing tests across every current view family;
- shared-resource self-containment assertions;
- modern MCP protocol tests requiring one canonical Sportfolio UI resource;
- plugin UI architecture audit;
- marketplace, capability-governance, catalog, privacy, package, submission, OAuth, and MCP regression checks.

Run locally with:

```bash
npm run plugin:ui:build
npm run plugin:ui:harness # serves a deterministic delayed-result browser fixture on :4173
npx vitest run \
  client/src/plugin-ui/openai-host.test.ts \
  client/src/plugin-ui/sportfolio-widget-entry.test.ts \
  server/mcp/plugin/ui/shared-resource.test.ts \
  server/mcp/plugin/ui/protocol-resource.test.ts
npm run plugin:ui:audit
npm run check
npm run build
```

For a hosted smoke test, set `PLUGIN_UI_SMOKE_URL` to the canonical MCP URL and
run `npm run plugin:ui:live-smoke`. The probe validates the shared resource,
OAuth challenge behavior, and at least one public render path without logging
tokens or user data.
