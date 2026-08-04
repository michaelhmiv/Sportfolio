# Unified Sports Data — Release A

## Objective

Reduce the public Sportfolio MCP and ChatGPT app surface before introducing the unified MLB, NHL, and NASCAR adapter layer.

Sportfolio remains responsible for authenticated account state, holdings, virtual market state, AMM quotes and liquidity, trades, scouting, boosts, collections, watchlists, Sportfolio scoring, structured sports information, provider-to-Sportfolio identity mapping, and staged writes.

ChatGPT is responsible for general web research, sports news, injuries, trade rumors, narrative analysis, explanations, recommendations, and user-created scheduled summaries.

## Public capabilities to remove

Remove these categories from public MCP registration, plugin catalogs, submission artifacts, skills, tests, and fixtures:

- Hermes agent capabilities and configuration
- agent profile and BYOK management
- agent threads, messages, and research sources
- hosted research and advisory review tools
- legacy advisory schedules
- SMS linking and settings
- generated news and daily digests
- every dynamically discovered raw MLB provider tool prefixed `mlb_mcp__`

Known tool names include:

- `get_agent_capabilities`
- `get_agent_profile`
- `update_agent_profile`
- `clear_agent_byok`
- `save_agent_byok`
- `create_agent_thread`
- `list_agent_threads`
- `list_thread_messages`
- `list_thread_research_sources`
- `get_thread_state`
- `send_agent_message`
- `run_hosted_research`
- `review_idle_cash`
- `review_news_impact`
- `review_portfolio_cleanup`
- `review_setup`
- `list_schedule_templates`
- `list_schedules`
- `upsert_schedule`
- `delete_schedule`
- `get_sms_settings`
- `update_sms_settings`
- `start_sms_link`
- `complete_sms_link`
- `get_news_digest`
- `get_news_unread_count`
- `mark_news_read`

## Retained public capabilities

Retain focused tools for:

- player search and focused player research
- games and structured schedules
- holdings and portfolio state
- market state, quotes, staged buys and sells
- scouting and staged scout assignments
- daily and community boosts
- collections and milestones
- watchlists
- liquidity positions and staged liquidity actions
- profile/account controls
- pending-action inspection, confirmation, and cancellation
- public documentation
- MCP Apps UI render tools added in PR #331

## Implementation requirements

1. Add a reproducible inventory of approved, denied, and provider-pass-through tools.
2. Replace unrestricted registry parity with an explicit approved-public-catalog contract.
3. Ensure denied names and the `mlb_mcp__` prefix cannot appear in public `tools/list` or generated submission artifacts.
4. Remove legacy-only client routes, navigation, hooks, and UI entry points.
5. Keep ordinary sports/news content when it is not solely a generated digest surface.
6. Isolate remaining legacy backend routes and jobs behind a default-off emergency flag such as `LEGACY_AGENT_ROUTES_ENABLED=false`.
7. Prevent creation of new agent threads, advisory schedules, SMS links, hosted research runs, and generated digests by default.
8. Log attempted deprecated access without prompts, secrets, tokens, phone numbers, email addresses, or user identifiers.
9. Preserve OAuth boundaries and staged-action confirmation.
10. Update plugin UI tests, MCP protocol tests, catalog snapshots, submission artifacts, package validation, skill documents, and readiness CI.

## Deferred work

This release must not:

- delete database tables or columns;
- remove production environment variables;
- remove the internal MLB compatibility client;
- retire the standalone `mlb-mcp` Railway service;
- implement the new unified sports adapters;
- change established virtual-market economics.

## Production baseline observed August 4, 2026

- The main Railway application and standalone `mlb-mcp` service are both deployed successfully.
- The main service still runs the `agent_advisory_schedules` scheduled job.
- The production client build still emits an `sms-link` bundle.
- MLB schedule and live-stat synchronization already run directly in the main Sportfolio service through StatsAPI.
- NHL schedule, roster, stats, and live-stat jobs exist in the main repository.
- NASCAR roster, schedule, stats, and live-race jobs exist in the main repository.
- A transient NASCAR upstream HTTP 504 was observed and recovered on the next scheduled cycle.

## Validation

Run at minimum:

```bash
npm ci
npm run check
npm run lint
npm run format:check
npm run test:run
npm run build
```

Also run all repository commands covering plugin readiness, MCP protocol regression, plugin UI contracts, catalog snapshots, package validation, privacy scans, submission freshness, and marketplace smoke tests.

## Rollback

Release A is reversible by reverting its merge commit and redeploying. Database and Railway-service deletion are intentionally deferred so rollback does not require data restoration or service recreation.
