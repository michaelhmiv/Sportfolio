# Unified Sports Data — Release A

## Objective

Reduce the public Sportfolio MCP and ChatGPT app surface before introducing the unified MLB, NHL, and NASCAR adapter layer.

Sportfolio remains responsible for authenticated account state, holdings, virtual market state, AMM quotes and liquidity, trades, scouting, boosts, collections, watchlists, Sportfolio scoring, structured sports information, provider-to-Sportfolio identity mapping, and staged writes.

ChatGPT is responsible for general web research, sports news, injuries, trade rumors, narrative analysis, explanations, recommendations, and user-created scheduled summaries.

## Implemented public-surface policy

Release A removes these categories from public MCP registration and the ChatGPT marketplace catalog:

- Hermes agent capabilities and configuration;
- agent profile and BYOK management;
- agent threads, messages, and research sources;
- hosted research and advisory review tools;
- legacy advisory schedules;
- SMS linking and settings;
- generated news and daily digests;
- every dynamically discovered raw MLB provider tool prefixed `mlb_mcp__`.

The controlling rule is `server/mcp/public-tool-policy.ts`. Static tools and prompts are filtered through that policy. Dynamic MLB discovery remains available only as an internal compatibility path and contributes zero public tools.

## Marketplace catalog

The ChatGPT marketplace catalog contains 20 compact tools after removing the legacy aliases:

- `get_my_news_digest`;
- `review_my_sportfolio_setup`.

Skill guidance, marketplace documentation, adapters, the frozen catalog snapshot, and `chatgpt-app-submission.json` were regenerated from the approved catalog together.

## Retained public capabilities

Release A retains focused tools for:

- player search and focused player research;
- games and structured schedules;
- holdings and portfolio state;
- market state, quotes, staged buys and sells;
- scouting and staged scout assignments;
- daily and community boosts;
- collections and milestones;
- watchlists;
- liquidity positions and staged liquidity actions;
- profile/account controls;
- pending-action inspection, confirmation, and cancellation;
- public documentation;
- MCP Apps UI render tools added in PR #331.

## Safety and rollback

Release A does not:

- delete database tables or columns;
- remove production environment variables;
- remove the internal MLB compatibility client;
- retire the standalone `mlb-mcp` Railway service;
- implement the unified sports adapters;
- change virtual-market economics.

The release is reversible by reverting its merge commit and redeploying. Database and Railway-service deletion remain deferred so rollback does not require data restoration or service recreation.

## Validation

The implementation runner validates:

- the public-tool policy audit;
- public-policy and surface-coverage tests;
- repository type checking;
- changed-file linting;
- the production build;
- regeneration of the OpenAI submission import from the approved catalog.

Plugin Readiness validates:

- plugin TypeScript certification;
- marketplace adapter integrity;
- MCP audit and smoke tests;
- plugin UI contracts;
- catalog freeze;
- package, privacy, and submission checks;
- OAuth discovery and JWKS compatibility;
- production dependency security.

The MCP smoke test explicitly verifies that retired prompts and raw provider tools are not listed or present in capability resources, and that direct raw-tool calls return an MCP error result.

## Production baseline observed August 4, 2026

- The main Railway application and standalone `mlb-mcp` service are deployed successfully.
- The main service still runs the `agent_advisory_schedules` scheduled job.
- The production client build still emits an `sms-link` bundle.
- MLB schedule and live-stat synchronization already run directly in the main Sportfolio service through StatsAPI.
- NHL schedule, roster, stats, and live-stat jobs exist in the main repository.
- NASCAR roster, schedule, stats, and live-race jobs exist in the main repository.
- A transient NASCAR upstream HTTP 504 was observed and recovered on the next scheduled cycle.

## Follow-on releases

Release B introduces sport-neutral internal types, an adapter registry, provider-ID resolution, and normalized NASCAR series identifiers. Later releases add curated MLB, NHL, and NASCAR adapters, compact sports-data tools, data-semantic corrections, observability, legacy code deletion, and eventual standalone MLB service retirement after zero-use verification.
