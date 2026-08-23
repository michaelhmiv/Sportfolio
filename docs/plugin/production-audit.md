# Sportfolio ChatGPT/OpenAI MCP production audit

This report records the implementation pass against `main@169dae06d45261e3184aceb9fd7795b78e027d34`. The machine-readable per-tool inventory is in [production-tool-inventory.json](./production-tool-inventory.json), and the routing/evaluation set is in [golden-prompts.json](./golden-prompts.json).

## Result at a glance

The current source surface is 102 model-visible tools: 85 bounded data/action tools, 2 bounded fast paths, and 15 UI-only render tools. The previous source catalog was 112 tools: 89 static tools, 6 analytics-only tools registered only on the plugin surface, 2 fast paths, and 15 render tools. Ten tools were removed from ChatGPT routing. The non-plugin MCP server can still retain internal analytics primitives where the website or operator workflows require them.

The current product contract is Singles plus direct-share Daily Boosts. `stage_daily_boost_assign` now publishes and validates `playerId`, `slotTier`, `shares`, optional `date`, and optional `sport`; the valid tier enum is `2 | 3 | 5 | 7 | 10`. Stack Shares/Stack Power registrations, notification paths, metadata, and compatibility test fixtures were removed. Legitimate Daily Boost multiplier fields remain.

## Reproduced failures and fixes

| Failure                                                | Root cause                                                                                                        | Resolution                                                                                                                     | Regression guard                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Daily Boost stage rejected missing `shares`            | Public schema and stale/underlying preview contract disagreed                                                     | `shares` is required in the canonical public schema and is passed unchanged to the preview transaction                         | `public-tool-contract.test.ts`, economy-v2 registry test, staging transaction tests |
| Dashboard rejected `recentLotsLimit`                   | The composed renderer forwarded a UI argument to a child that expected a different key                            | Dashboard now owns one `recentLotsLimit` contract and passes only `sport/date` to child reads                                  | dashboard contract fixture and overview surface test                                |
| Portfolio output exceeded warning max                  | Canonical valuation drift warnings were normal presentation diagnostics and were copied into model-visible output | Current-price drift is diagnostic-only; presentation warnings are deduplicated and capped at 20                                | canonical valuation test and presentation warning tests                             |
| Boost history was unavailable                          | `render_boosts` forwarded `sport/date` to `list_daily_boost_history`, whose contract is `limit` only              | Renderer passes only `{limit}` to history                                                                                      | gameplay surface test                                                               |
| `get_holding_multiplier_state` leaked `ExceptionGroup` | Stale runtime/mock exposure bypassed the current error boundary                                                   | Tool is absent from the public registry; all public/plugin catches normalize to a stable error code/message/retryable envelope | public error tests, catalog absence test                                            |
| `stage_stack_shares` was exposed                       | Stale connector/runtime catalog and retired notification/runtime references survived the Economy V2 cleanup       | Removed from current registrations, UI/runtime bindings, docs/test fixtures, and governance surface                            | retired audits and catalog absence test                                             |

## Error contract

Normal failures are now machine-readable and intentionally minimal. Supported codes are `invalid_input`, `unauthorized`, `auth_expired`, `not_found`, `ineligible`, `conflict`, `stale_transaction`, `provider_unavailable`, `timeout`, `retryable_transient`, and `internal_failure`. Framework errors, task-group text, stack traces, tokens, and secrets are not returned to ChatGPT. Retryability is explicit instead of inferred from a raw exception string.

## Latency evidence

The production Railway HTTP sample on the pre-change deployment was used as the baseline. The sample contained 59 `/mcp` requests, 56 successful responses, and three GET/405 probes.

| Path/workload           | Requests |    p50 |    p95 | p99/max | Notes                                                            |
| ----------------------- | -------: | -----: | -----: | ------: | ---------------------------------------------------------------- |
| `/mcp`                  |       59 |  27 ms | 160 ms |  253 ms | Includes mixed MCP calls and protocol probes                     |
| `/api/dashboard`        |  sampled | 134 ms | 187 ms |       — | Website baseline                                                 |
| `/api/market/scanners`  |  sampled | 121 ms | 192 ms |       — | Website baseline                                                 |
| `/api/games/insights`   |  sampled | 304 ms | 515 ms |       — | External sports-provider dependent                               |
| Auth token endpoint     |  sampled | ~89 ms |      — |       — | Auth/session overhead                                            |
| `/api/health`           |  sampled | 2–3 ms |      — |       — | Process health                                                   |
| Plugin page             |  sampled |      — |  41 ms |       — | Static/plugin shell baseline                                     |
| Shared MCP App resource |        1 |      — |      — |       — | 238,034 bytes self-contained HTML/JS before transfer compression |

The implementation removes known extra fan-out from the dashboard, runs independent dashboard reads concurrently, bounds composed lists, avoids duplicate widget tool names, and keeps normal warnings out of the model-visible envelope. Per-tool post-deploy p50/p95/p99 and response-byte values are intentionally left null in the inventory until an attributable production benchmark sample is captured; the verification step records those values against the final deployment rather than fabricating precision from aggregate HTTP logs.

## Tool decisions

Removed from the ChatGPT surface:

- `stage_stack_shares` — retired economy concept; no compatibility alias.
- `get_holding_multiplier_state` — stale runtime-only exposure with no current product contract.
- `list_market_opportunities` and `get_market_scanners` — overlapping scanner/opportunity reads.
- `list_watchlist_player_ids` — redundant watchlist primitive.
- `list_community_boost_history` — redundant history primitive; the bounded boost renderer composes the needed history.
- `get_market_overview`, `screen_markets`, `get_market_index`, `get_market_tape`, `compare_player_markets`, and `get_market_correlations` — analytics-only tools removed from ChatGPT model-visible registration; they remain available to the non-plugin MCP server where internal use requires them.

MLB-specific tools remain because the unified sports adapter does not yet cover MLB splits, Statcast profiles, probable pitchers, rosters, standings, and provider-native leaderboards with equivalent bounded contracts. They are explicitly named, provider-scoped, and read-only. They should be migrated behind the unified adapter only after parity and latency tests demonstrate no routing or reliability regression.

## UI capability map

| Workflow                                                               | Presentation                      | Reason                                                       |
| ---------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| Balance, player snapshot, single LP position, milestone                | Plain text or inline card         | Small, self-contained facts; UI is optional                  |
| Trade, Daily Boost, scout, LP, community-boost review                  | Inline review card/modal          | Exact server-issued transaction with explicit Confirm/Cancel |
| Market movers, boost candidates, scout candidates, watchlist, rankings | Carousel                          | Small ranked set; “show more” stays conversational           |
| Portfolio, dashboard, collections, detailed market/history             | Fullscreen                        | Rich exploration and bounded local sort/filter               |
| Live NASCAR/MLB/NHL/NFL event                                          | Picture-in-picture when supported | Ongoing state benefits from a persistent compact view        |
| Short focused detail/confirmation                                      | Host modal when feature-detected  | Keeps the parent widget context intact                       |

The widget uses the MCP Apps bridge first (`ui/initialize`, tool input/result notifications, `tools/call`, `ui/message`, `ui/update-model-context`) and treats `window.openai` features as optional enhancements. The shared resource is content-addressed, CSP-limited to `https://www.sportfolio.market`, self-contained, theme-aware, keyboard-accessible, responsive, and capable of display-mode changes. Data tools remain decoupled from render tools; the render tools own the UI resource association.

## Submission checklist

| Requirement                                               | Status                                                                                                 | Evidence/remaining action                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Public production MCP URL                                 | Verify after final Railway deployment                                                                  | `/mcp` is the production endpoint; final smoke must record the deployed SHA           |
| OAuth/auth behavior                                       | Implemented; production reviewer fixture pending verification                                          | Public tools are limited to documented no-auth reads; user data/actions require OAuth |
| Reviewer credentials without MFA/email/SMS dependency     | Pending external reviewer credential confirmation                                                      | Must be checked before submission                                                     |
| Accurate read-only/destructive/open-world annotations     | Implemented and tested in plugin catalog                                                               | Staged writes are not marked destructive; confirmation finalizer is destructive       |
| Input/output schema parity                                | Implemented                                                                                            | Registry-generated fixture test and renderer contract tests                           |
| UI resource metadata/CSP                                  | Implemented                                                                                            | Shared resource test and UI audit                                                     |
| Privacy policy, domain verification, icons/listing assets | Pending listing-owner confirmation                                                                     | Not inferable from repository code alone                                              |
| Starter prompts and positive/negative cases               | Implemented                                                                                            | `golden-prompts.json`; submission JSON retains the required compact cases             |
| No debug/internal identifiers in normal responses         | Implemented                                                                                            | Sanitizer plus stable error envelope tests                                            |
| Provider resilience                                       | Implemented at error boundary; provider-specific stale/partial policy remains an operational follow-up | Provider failures normalize to `provider_unavailable`/retryable                       |

## CI and verification gates

The plugin readiness workflow now includes typecheck, catalog/governance checks, retired-surface audits, public tool fixture/contract tests, warning-bound tests, generated-widget tool-name parity, and the existing UI/resource checks. The golden prompt checker enforces 30+ cases, at least 5 positives and 3 negatives, and rejects retired Stack/runtime names.

## Remaining limitations

The local repository has no authority to create or validate reviewer credentials, domain-verification records, or marketplace listing assets. Railway also had a stale worker `preDeployCommand` (`npm run db:migrate:economy-v2`) on the baseline deployment; production verification must remove that obsolete hook and confirm a successful worker deployment before the integration can be called fully clean.
