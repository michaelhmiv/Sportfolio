# Sportfolio ChatGPT UI Architecture

## Scope

Sportfolio exposes interactive MCP Apps UI resources in addition to its shared public business-tool catalog. The UI layer is presentation-only: it builds bounded, sanitized view models and calls the same shared Sportfolio tools used by other MCP clients for all mutations.

## Architectural boundary

- `server/mcp/public-tool-registry.ts` remains the source of truth for reusable business reads and writes.
- `server/mcp/plugin/registry.ts` continues to expose exact business-tool parity through the OAuth marketplace endpoint.
- `server/mcp/plugin/ui/surface.ts` owns plugin-only `render_*` tools and versioned `ui://` resources.
- `client/src/plugin-ui/sportfolio-widget.tsx` is a separately bundled React component application.
- `scripts/build-plugin-ui.mjs` bundles the widget and generates the server-importable HTML resource.

Presentation tools are always read-only, non-destructive, and closed-world. They are intentionally excluded from the shared business-tool parity assertion.

## Registered surfaces

| Tool                        | Resource                                | Access                             | Purpose                                                                            |
| --------------------------- | --------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| `render_player_market`      | `ui://sportfolio/player-market/v1.html` | Public with optional OAuth context | Player identity, pool price, bounded history, holdings, quotes, and staged trading |
| `render_trade_preview`      | `ui://sportfolio/trade-preview/v1.html` | OAuth                              | Exact pending-bundle confirmation and cancellation                                 |
| `render_portfolio`          | `ui://sportfolio/portfolio/v1.html`     | OAuth                              | Portfolio value, balance, allocation, and holding exploration                      |
| `render_market_movers`      | `ui://sportfolio/market-movers/v1.html` | Public; OAuth for watchlist scope  | Gainers, decliners, volume, trade activity, and watchlist movers                   |
| `render_liquidity_position` | `ui://sportfolio/liquidity/v1.html`     | OAuth                              | AMM pool state, LP position, and staged add/remove liquidity actions               |

## Mutation safety

The widget never calls Sportfolio REST mutation routes. It invokes MCP tools through `window.openai.callTool` when available and the standard MCP Apps `tools/call` bridge otherwise.

Market actions use:

1. `get_amm_trade_quote`
2. `stage_market_buy` or `stage_market_sell`
3. `confirm_pending_action` or `cancel_pending_action`

Liquidity actions use:

1. `stage_lp_add` or `stage_lp_remove`
2. `confirm_pending_action` or `cancel_pending_action`

The widget does not resend or modify staged action contents during confirmation. It confirms only the server-issued `threadId` and `pendingBundleId`.

## State and refresh behavior

Authoritative prices, balances, holdings, quotes, and LP positions always come from Sportfolio server calls. Widget state is limited to presentation choices such as selected range, buy/sell mode, form inputs, and the currently displayed view.

Market quotes are debounced and protected against out-of-order responses. Price histories are downsampled server-side to at most 80 points before reaching the component.

## Security

- UI resources use `text/html;profile=mcp-app`.
- Resource URIs are versioned and immutable within a release.
- CSP currently allows no direct network connections and no external resource domains.
- Private portfolio, holding, balance, pending-action, and liquidity data require OAuth.
- Public player names are converted to `displayName` before the plugin sanitizer runs; account PII remains subject to the existing sanitizer deny list.
- The iframe never receives OAuth credentials or Sportfolio API tokens.

## Feature flags

- `PLUGIN_UI_ENABLED`
- `PLUGIN_UI_MARKET_ENABLED`
- `PLUGIN_UI_TRADING_ENABLED`
- `PLUGIN_UI_PORTFOLIO_ENABLED`
- `PLUGIN_UI_DISCOVERY_ENABLED`
- `PLUGIN_UI_LIQUIDITY_ENABLED`

Unset flags default to enabled. Any flag can be set to `false`, `0`, `off`, or `no` to disable its surface without reverting a deployment.

## Validation

The plugin readiness workflow runs:

- isolated widget build;
- plugin-specific and repository TypeScript checks;
- production build;
- UI catalog unit tests;
- shared marketplace audit;
- plugin UI contract audit;
- existing catalog, privacy, package, submission, OAuth, and MCP regression checks.

Run locally with:

```bash
npm run plugin:ui:build
npm run plugin:ui:audit
npm run check
npm run build
npx vitest run server/mcp/plugin/ui/surface.test.ts
```
